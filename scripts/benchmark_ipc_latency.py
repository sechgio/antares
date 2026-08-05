"""Reproducible IPC latency benchmark: Primera vs stable p50/p95.

Spawns a real ``backend.main`` process over JSON-RPC stdio with a disposable
``LOCALAPPDATA`` profile. Prints JSON to stdout; does not write results into
the repository.

Usage:
  python scripts/benchmark_ipc_latency.py
  python scripts/benchmark_ipc_latency.py --methods panel_aviso_corte_render_pdf,version
  python scripts/benchmark_ipc_latency.py --confirm-method panel_aviso_corte_render_pdf
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

QUICK_SAMPLES = 25
HEAVY_SAMPLES = 30
TIMEOUT_SECONDS = 45.0


def nearest_rank_percentile(values: list[float], q: float) -> float:
    if not values:
        raise ValueError("values must be non-empty")
    ordered = sorted(values)
    rank = max(1, math.ceil(q * len(ordered)))
    return ordered[rank - 1]


def registry_methods() -> list[str]:
    from backend.handlers import HANDLERS

    return sorted(HANDLERS.keys())


def heavy_methods() -> frozenset[str]:
    from backend.main import HEAVY_METHODS

    return frozenset(HEAVY_METHODS)


def summarize_latencies(
    *,
    method: str,
    first_ms: float,
    stable_ms: list[float],
    timeouts: int,
    errors: int,
    route_status: str,
) -> dict[str, Any]:
    n = len(stable_ms)
    row: dict[str, Any] = {
        "method": method,
        "first_ms": round(first_ms, 3),
        "n": n,
        "timeouts": timeouts,
        "errors": errors,
        "route_status": route_status,
    }
    if n == 0:
        row.update({"p50_ms": None, "p95_ms": None, "p95_p50_ratio": None})
        return row
    p50 = nearest_rank_percentile(stable_ms, 0.50)
    p95 = nearest_rank_percentile(stable_ms, 0.95)
    row.update(
        {
            "p50_ms": round(p50, 3),
            "p95_ms": round(p95, 3),
            "min_ms": round(min(stable_ms), 3),
            "max_ms": round(max(stable_ms), 3),
            "mean_ms": round(statistics.fmean(stable_ms), 3),
            "p95_p50_ratio": round(p95 / p50, 3) if p50 > 0 else None,
        }
    )
    return row


def select_stable_leader(
    rows: list[dict[str, Any]],
    *,
    max_p95_p50_ratio: float = 10.0,
) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    for row in rows:
        if row.get("route_status") != "success":
            continue
        if row.get("timeouts", 0):
            continue
        if row.get("p95_ms") is None or row.get("n", 0) < 1:
            continue
        ratio = row.get("p95_p50_ratio")
        if ratio is not None and ratio > max_p95_p50_ratio:
            continue
        candidates.append(row)
    if not candidates:
        return None
    return max(candidates, key=lambda r: float(r["p95_ms"]))


def batches_agree(p95_a: float, p95_b: float, *, tolerance: float = 0.15) -> bool:
    baseline = max(p95_a, p95_b, 1e-9)
    return abs(p95_a - p95_b) / baseline <= tolerance


class IPCProcess:
    def __init__(self, profile_dir: Path, *, telemetry: bool = False) -> None:
        self.profile_dir = profile_dir
        self.profile_dir.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env.update(
            {
                "LOCALAPPDATA": str(self.profile_dir),
                "PYTHONUNBUFFERED": "1",
                "PYTHONUTF8": "1",
                "ANTARES_ENABLE_PLUGINS": "0",
                "ANTARES_MAP_PROVIDER": "google",
            }
        )
        if telemetry:
            env["ANTARES_IPC_TELEMETRY"] = "1"
        else:
            env.pop("ANTARES_IPC_TELEMETRY", None)
        self.started_at = time.perf_counter()
        self.proc = subprocess.Popen(
            [sys.executable, "-u", "backend/main.py"],
            cwd=PROJECT_ROOT,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        self._condition = threading.Condition()
        self._write_lock = threading.Lock()
        self._responses: dict[int, tuple[float, dict[str, Any]]] = {}
        self._stderr: list[str] = []
        self._next_id = 0
        self.ready_at: float | None = None
        self._stop = threading.Event()
        self._threads = [
            threading.Thread(target=self._read_stdout, daemon=True),
            threading.Thread(target=self._read_stderr, daemon=True),
        ]
        for thread in self._threads:
            thread.start()

    def _read_stdout(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            observed = time.perf_counter()
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if payload.get("method") == "ready" and self.ready_at is None:
                self.ready_at = observed
            if "id" in payload:
                with self._condition:
                    self._responses[int(payload["id"])] = (observed, payload)
                    self._condition.notify_all()

    def _read_stderr(self) -> None:
        assert self.proc.stderr is not None
        for line in self.proc.stderr:
            if len(self._stderr) < 8000:
                self._stderr.append(line.rstrip())

    def wait_ready(self, timeout: float = TIMEOUT_SECONDS) -> float:
        deadline = time.perf_counter() + timeout
        while self.ready_at is None:
            if self.proc.poll() is not None:
                raise RuntimeError(
                    f"Backend exited before ready: {self.proc.returncode}\n"
                    + "\n".join(self._stderr[-40:])
                )
            if time.perf_counter() >= deadline:
                raise TimeoutError("Timed out waiting for ready")
            time.sleep(0.005)
        return (self.ready_at - self.started_at) * 1000.0

    def rpc(
        self,
        method: str,
        params: dict[str, Any],
        timeout: float = TIMEOUT_SECONDS,
    ) -> tuple[float, dict[str, Any]]:
        with self._write_lock:
            self._next_id += 1
            request_id = self._next_id
            request = {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params,
            }
            encoded = json.dumps(request, ensure_ascii=False, separators=(",", ":"))
            sent_at = time.perf_counter_ns() / 1_000_000_000.0
            assert self.proc.stdin is not None
            self.proc.stdin.write(encoded + "\n")
            self.proc.stdin.flush()
        deadline = sent_at + timeout
        with self._condition:
            while request_id not in self._responses:
                remaining = deadline - time.perf_counter()
                if remaining <= 0:
                    raise TimeoutError(f"Timed out waiting for {method}")
                self._condition.wait(min(remaining, 0.1))
            observed, response = self._responses.pop(request_id)
        return (observed - sent_at) * 1000.0, response

    def stderr_tail(self, n: int = 80) -> list[str]:
        return self._stderr[-n:]

    def close(self) -> None:
        try:
            if self.proc.stdin is not None:
                self.proc.stdin.close()
            self.proc.wait(timeout=20)
        except Exception:
            self.proc.kill()
            self.proc.wait(timeout=5)
        finally:
            self._stop.set()
            for thread in self._threads:
                thread.join(timeout=1)


def make_fixtures(base: Path) -> dict[str, Any]:
    base.mkdir(parents=True, exist_ok=True)
    from io import BytesIO

    import fitz
    from openpyxl import Workbook
    from PIL import Image

    workbook_path = base / "catalog.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["ID", "RENOMBRE"])
    sheet.append(["A001", "muestra"])
    workbook.save(workbook_path)
    xlsx_b64 = base64.b64encode(workbook_path.read_bytes()).decode("ascii")

    image = Image.new("RGB", (24, 24), (210, 30, 30))
    image_buffer = BytesIO()
    image.save(image_buffer, format="PNG")
    png_bytes = image_buffer.getvalue()
    png_b64 = base64.b64encode(png_bytes).decode("ascii")

    pdf_path = base / "sample.pdf"
    document = fitz.open()
    page = document.new_page(width=300, height=300)
    page.insert_text((40, 60), "Antares IPC benchmark")
    document.save(pdf_path)
    document.close()
    pdf_bytes = pdf_path.read_bytes()

    output_dir = base / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    return {
        "workbook_path": str(workbook_path),
        "xlsx_b64": xlsx_b64,
        "png_b64": png_b64,
        "pdf_path": str(pdf_path),
        "pdf_b64": base64.b64encode(pdf_bytes).decode("ascii"),
        "output_dir": str(output_dir),
    }


def build_params(fixtures: dict[str, Any], setup: dict[str, Any], methods: list[str]) -> dict[str, dict[str, Any]]:
    output_dir = Path(fixtures["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    png_file = {"filename": "pixel.png", "content_b64": fixtures["png_b64"]}
    params: dict[str, dict[str, Any]] = {method: {} for method in methods}
    params.update(
        {
            "canvas_get": {"id": setup.get("canvas_id", "missing")},
            "canvas_get_history": {"id": setup.get("canvas_id", "missing")},
            "canvas_save": {"document": setup.get("canvas_document", {})},
            "canvas_save_history": {
                "id": setup.get("canvas_id", "missing"),
                "past": [],
                "future": [],
            },
            "canvas_duplicate": {
                "id": setup.get("canvas_id", "missing"),
                "name": "Benchmark copy",
            },
            "canvas_delete": {"id": "audit-missing-document"},
            "canvas_export_cmyk_pdf": {"document": setup.get("canvas_document", {})},
            "db_detect_key_column": {"files": []},
            "db_export": {"path": str(output_dir / "catalog-export.xlsx")},
            "db_fields_update": {"fields": setup.get("db_fields", [])},
            "db_import": {"path": fixtures["workbook_path"]},
            "db_parse_mapping": {"path": fixtures["workbook_path"], "files": ["A001.jpg"]},
            "db_records": {"limit": 1, "offset": 0},
            "db_template": {"path": str(output_dir / "catalog-template.xlsx")},
            "db_validate_mapping": {"mapping": {"A001": "muestra"}, "files": ["A001.jpg"]},
            "fichas_tecnicas_delete": {"id": "audit-missing"},
            "fichas_tecnicas_get": {"id": setup.get("ficha_id", "audit-missing")},
            "fichas_tecnicas_render_html": {"template": True},
            "fichas_tecnicas_update": {"id": "", "ficha": None},
            "formatos_delete": {"format_id": "audit-missing"},
            "formatos_generate": {
                "format_id": setup.get("format_id", ""),
                "desde": 1,
                "hasta": 1,
            },
            "formatos_get_template": {"format_id": setup.get("format_id", "")},
            "formatos_render_template_page": {
                "format_id": setup.get("format_id", ""),
                "page_num": 1,
                "max_width": 600,
            },
            "formatos_update_mapping": {"format_id": "audit-missing", "mapping": {}},
            "formatos_upload": {
                "content_b64": "",
                "nombre": "audit",
                "filename": "audit.pdf",
            },
            "generar_ubicaciones": {},
            "history_delete": {"id": 999999999},
            "history_delete_many": {"ids": []},
            "history_export": {"ids": [], "limit": 1},
            "history_get": {"id": 999999999},
            "history_list": {"limit": 1, "offset": 0},
            "history_save": {"files": [], "options": {}, "run_type": "audit"},
            "image_optimizer_save_files": {
                "files": [png_file],
                "output_folder": str(output_dir / "optimized"),
            },
            "image_optimizer_zip": {"files": [png_file], "zip_name": "audit.zip"},
            "informes_v2_delete": {"id": "audit-missing"},
            "informes_v2_get": {"id": setup.get("informe_id", "audit-missing")},
            "informes_v2_render_html": {"report": setup.get("informe_report", {})},
            "informes_v2_update": {"id": "", "report": None},
            "is_video": {"path": str(output_dir / "missing.bin")},
            "panel_aviso_corte_compute_match": {
                "rows": [{"ID": "A001", "DIRECCION": "Calle 1"}],
                "key_column": "ID",
                "image_names": ["A001.jpg"],
            },
            "panel_aviso_corte_parse_excel": {
                "xlsx_b64": fixtures["xlsx_b64"],
                "filename": "audit.xlsx",
            },
            "panel_aviso_corte_render_pdf": {"panels": setup.get("panels", [])},
            "panel_aviso_corte_template": {
                "path": str(output_dir / "panel-template.xlsx"),
                "overwrite": True,
            },
            "preview": {"files": []},
            "preview_ubicacion": {},
            "process_cancel": {"job_id": "audit-missing"},
            "process_start": {"files": [], "destino": ""},
            "process_status": {"job_id": "audit-missing"},
            "rename_patterns_update": {"patterns": setup.get("patterns", [])},
            "sellador_apply": {
                "pdf_b64": fixtures["pdf_b64"],
                "stamp_b64": fixtures["png_b64"],
                "stamp_count": 1,
                "x": 10,
                "y": 10,
                "width": 24,
                "height": 24,
                "seed": 1,
            },
            "sellador_inspect_pdf": {"pdf_path": fixtures["pdf_path"]},
            "sellador_render_page": {
                "pdf_path": fixtures["pdf_path"],
                "page_num": 1,
                "max_width": 600,
            },
            "technical_reports_autocomplete_contratista": {},
            "technical_reports_delete": {"id": "audit-missing"},
            "technical_reports_get": {"id": setup.get("technical_id", "audit-missing")},
            "technical_reports_render_html": {
                "report": setup.get("technical_report", {}),
            },
            "technical_reports_update": {"id": "", "report": None},
            "template_get": {"name": "report.html"},
            "theme_preset": {"name": setup.get("preset_name", "")},
            "theme_save": setup.get("theme", {}),
            "evidencia_volanteo_render": {
                "template": True,
            },
            "fichas_tecnicas_import_file": {"content_b64": "", "filename": "x.xlsx"},
            "informes_v2_import_file": {"content_b64": "", "filename": "x.xlsx"},
            "technical_reports_import_file": {"content_b64": "", "filename": "x.xlsx"},
            "fichas_tecnicas_create": {},
            "informes_v2_create": {},
            "technical_reports_create": {},
            "informes_v2_download_template": {
                "path": str(output_dir / "informes-v2-template.xlsx"),
            },
            "fichas_tecnicas_render_consolidated_html": {"ids": []},
            "informes_v2_render_consolidated_html": {"ids": []},
            "technical_reports_render_consolidated_html": {"ids": []},
            "technical_reports_autocomplete_cs": {},
            "canvas_create": {"name": "bench-create"},
            "canvas_list": {},
            "db_clear": {},
            "db_columns": {},
            "db_fields": {},
            "db_fields_reset": {},
            "fichas_tecnicas_clear": {},
            "fichas_tecnicas_list": {},
            "formatos_list": {},
            "formats": {},
            "informes_v2_clear": {},
            "informes_v2_list": {},
            "rename_patterns_get": {},
            "rename_patterns_reset": {},
            "technical_reports_clear": {},
            "technical_reports_list": {},
            "templates_list": {},
            "theme_get": {},
            "theme_presets": {},
            "theme_reset": {},
            "version": {},
        }
    )
    # Ensure every requested method has a params entry.
    for method in methods:
        params.setdefault(method, {})
    return params


def setup_process(ipc: IPCProcess, fixtures: dict[str, Any]) -> dict[str, Any]:
    setup: dict[str, Any] = {}

    def result(method: str, params: dict[str, Any]) -> Any:
        _, response = ipc.rpc(method, params)
        return response.get("result") or {}

    setup["theme"] = result("theme_get", {})
    setup["db_fields"] = result("db_fields", {}).get("fields", [])
    setup["patterns"] = result("rename_patterns_get", {}).get("patterns", [])
    presets = result("theme_presets", {}).get("presets", [])
    setup["preset_name"] = presets[0] if presets else ""

    # Upload a disposable PDF format so render/generate paths are representative.
    upload = result(
        "formatos_upload",
        {
            "content_b64": fixtures["pdf_b64"],
            "nombre": "bench-format",
            "filename": "bench.pdf",
        },
    )
    setup["format_id"] = (
        upload.get("id")
        or upload.get("format_id")
        or (upload.get("format") or {}).get("id")
        or ""
    )
    if not setup["format_id"]:
        formats = result("formatos_list", {}).get("formats", [])
        if formats and isinstance(formats[0], dict):
            setup["format_id"] = (
                formats[0].get("id")
                or formats[0].get("format_id")
                or formats[0].get("value")
                or ""
            )

    canvas = result("canvas_create", {"name": "IPC audit base"}).get("document", {})
    setup["canvas_document"] = canvas
    setup["canvas_id"] = canvas.get("id", "missing") if isinstance(canvas, dict) else "missing"

    technical = result("technical_reports_create", {}).get("report", {})
    setup["technical_report"] = technical
    setup["technical_id"] = (
        technical.get("id", "missing") if isinstance(technical, dict) else "missing"
    )

    informe = result("informes_v2_create", {}).get("report", {})
    setup["informe_report"] = informe
    setup["informe_id"] = (
        informe.get("id", "missing") if isinstance(informe, dict) else "missing"
    )

    ficha = result("fichas_tecnicas_create", {}).get("ficha", {})
    setup["ficha_id"] = ficha.get("id", "missing") if isinstance(ficha, dict) else "missing"

    panel_result = result(
        "panel_aviso_corte_compute_match",
        {
            "rows": [{"ID": "A001", "DIRECCION": "Calle 1"}],
            "key_column": "ID",
            "image_names": ["A001.jpg"],
        },
    )
    setup["panels"] = panel_result.get("panels", [])
    return setup


def _classify_route(stable: list[dict[str, Any]], timeouts: int) -> str:
    if not stable and timeouts:
        return "timeout"
    if not stable:
        return "error_path"
    errors = sum(1 for row in stable if row.get("error"))
    soft = sum(1 for row in stable if row.get("soft_fail"))
    n = len(stable)
    if errors == n:
        return "error_path"
    if soft == n:
        return "semantic_reject"
    if errors == 0 and soft == 0:
        return "success"
    return "mixed"


def _is_soft_fail(response: dict[str, Any]) -> bool:
    if "error" in response:
        return False
    result = response.get("result")
    if not isinstance(result, dict):
        return False
    # Ubicaciones soft-rejects when required geo/payload data is absent.
    if result.get("ok") is False:
        return True
    return bool(result.get("rejected") or result.get("semantic_reject"))


def benchmark_methods(
    ipc: IPCProcess,
    methods: list[str],
    params_by_method: dict[str, dict[str, Any]],
    *,
    quick_samples: int,
    heavy_samples: int,
    heavy: frozenset[str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for method in methods:
        params = params_by_method[method]
        samples = heavy_samples if method in heavy else quick_samples
        try:
            first_ms, first_response = ipc.rpc(method, params)
        except TimeoutError:
            rows.append(
                summarize_latencies(
                    method=method,
                    first_ms=TIMEOUT_SECONDS * 1000.0,
                    stable_ms=[],
                    timeouts=1,
                    errors=0,
                    route_status="timeout",
                )
            )
            continue

        stable_ms: list[float] = []
        stable_meta: list[dict[str, Any]] = []
        timeouts = 0
        for _ in range(samples):
            try:
                latency, response = ipc.rpc(method, params)
            except TimeoutError:
                timeouts += 1
                continue
            stable_ms.append(latency)
            stable_meta.append(
                {
                    "error": "error" in response,
                    "soft_fail": _is_soft_fail(response),
                }
            )
        errors = sum(1 for item in stable_meta if item["error"])
        route_status = _classify_route(stable_meta, timeouts)
        # Preserve first error info for debugging without polluting percentiles.
        row = summarize_latencies(
            method=method,
            first_ms=first_ms,
            stable_ms=stable_ms,
            timeouts=timeouts,
            errors=errors,
            route_status=route_status,
        )
        row["first_error"] = "error" in first_response
        rows.append(row)
    rows.sort(key=lambda r: (-(r["p95_ms"] or -1.0), r["method"]))
    return rows


def confirm_method(
    ipc: IPCProcess,
    method: str,
    params: dict[str, Any],
    *,
    samples: int = HEAVY_SAMPLES,
) -> dict[str, Any]:
    # Extra warm-up batch (discarded) so both measured batches start from a
    # settled WeasyPrint/font cache rather than mixing residual cold cost.
    for _ in range(samples):
        ipc.rpc(method, params)

    batches: list[dict[str, Any]] = []
    for batch_idx in range(2):
        first_ms, _ = ipc.rpc(method, params)
        stable: list[float] = []
        timeouts = 0
        errors = 0
        for _ in range(samples):
            try:
                latency, response = ipc.rpc(method, params)
            except TimeoutError:
                timeouts += 1
                continue
            stable.append(latency)
            if "error" in response:
                errors += 1
        summary = summarize_latencies(
            method=method,
            first_ms=first_ms,
            stable_ms=stable,
            timeouts=timeouts,
            errors=errors,
            route_status="success" if errors == 0 and timeouts == 0 and stable else "mixed",
        )
        summary["batch"] = batch_idx + 1
        batches.append(summary)
    p95_values = [b["p95_ms"] for b in batches if b["p95_ms"] is not None]
    agree = (
        batches_agree(float(p95_values[0]), float(p95_values[1]))
        if len(p95_values) == 2
        else False
    )
    return {"method": method, "batches": batches, "p95_agree_within_15pct": agree}


def telemetry_smoke(
    profile_dir: Path,
    fixtures_dir: Path,
    method: str,
) -> dict[str, Any]:
    fixtures = make_fixtures(fixtures_dir)
    ipc = IPCProcess(profile_dir / "telemetry", telemetry=True)
    try:
        ipc.wait_ready()
        setup = setup_process(ipc, fixtures)
        params = build_params(fixtures, setup, [method])[method]
        # Discard first (cold/warm-up), then one measured call.
        ipc.rpc(method, params)
        ipc.rpc(method, params)
        phase_lines = [line for line in ipc.stderr_tail(200) if "ipc_phase" in line and method in line]
        return {"method": method, "ipc_phase_lines": phase_lines[-3:]}
    finally:
        ipc.close()


def run_benchmark(
    *,
    methods: list[str] | None = None,
    quick_samples: int = QUICK_SAMPLES,
    heavy_samples: int = HEAVY_SAMPLES,
    confirm: str | None = None,
    with_telemetry_smoke: bool = False,
) -> dict[str, Any]:
    registered = registry_methods()
    if methods is None:
        methods = registered
    else:
        unknown = sorted(set(methods) - set(registered))
        if unknown:
            raise ValueError(f"Unknown methods not in HANDLERS: {unknown}")
        missing_coverage = sorted(set(registered) - set(methods))
        # Filtered runs are allowed; full runs must cover the registry.
        if not missing_coverage and set(methods) != set(registered):
            pass
    if methods == registered and len(methods) != len(registered):
        raise AssertionError("duplicate methods")

    heavy = heavy_methods()
    tmp = Path(tempfile.mkdtemp(prefix="antares-ipc-latency-"))
    try:
        fixtures = make_fixtures(tmp / "fixtures")
        ipc = IPCProcess(tmp / "profile", telemetry=False)
        try:
            ready_ms = ipc.wait_ready()
            setup = setup_process(ipc, fixtures)
            params_by_method = build_params(fixtures, setup, methods)
            if confirm:
                confirmation = confirm_method(
                    ipc,
                    confirm,
                    params_by_method[confirm],
                    samples=heavy_samples,
                )
                result: dict[str, Any] = {
                    "mode": "confirm",
                    "ready_ms": round(ready_ms, 3),
                    "confirmation": confirmation,
                    "sandbox": str(tmp),
                }
            else:
                endpoints = benchmark_methods(
                    ipc,
                    methods,
                    params_by_method,
                    quick_samples=quick_samples,
                    heavy_samples=heavy_samples,
                    heavy=heavy,
                )
                leader = select_stable_leader(endpoints)
                result = {
                    "mode": "full" if methods == registered else "filtered",
                    "ready_ms": round(ready_ms, 3),
                    "method_count": len(methods),
                    "registry_count": len(registered),
                    "quick_samples": quick_samples,
                    "heavy_samples": heavy_samples,
                    "endpoints": endpoints,
                    "stable_leader": leader,
                    "sandbox": str(tmp),
                    "methodology": {
                        "first": "one warm-up call per method excluded from p50/p95",
                        "clock": "perf_counter around stdin write+flush to matching stdout id",
                        "telemetry": "ANTARES_IPC_TELEMETRY off for ranking table",
                        "percentile": "nearest-rank",
                    },
                }
        finally:
            ipc.close()

        if with_telemetry_smoke and result.get("stable_leader"):
            leader_method = result["stable_leader"]["method"]
            result["telemetry_smoke"] = telemetry_smoke(
                tmp,
                tmp / "fixtures-telemetry",
                leader_method,
            )
        elif with_telemetry_smoke and confirm:
            result["telemetry_smoke"] = telemetry_smoke(
                tmp,
                tmp / "fixtures-telemetry",
                confirm,
            )
        return result
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--methods",
        default="",
        help="Comma-separated method filter (default: all HANDLERS)",
    )
    parser.add_argument("--quick-samples", type=int, default=QUICK_SAMPLES)
    parser.add_argument("--heavy-samples", type=int, default=HEAVY_SAMPLES)
    parser.add_argument(
        "--confirm-method",
        default="",
        help="Run two heavy batches of 30 for one method and check +/-15 percent p95 agreement",
    )
    parser.add_argument(
        "--telemetry-smoke",
        action="store_true",
        help="After ranking/confirm, spawn a telemetry-enabled process for phase lines",
    )
    args = parser.parse_args()
    methods = [m.strip() for m in args.methods.split(",") if m.strip()] or None
    confirm = args.confirm_method.strip() or None
    payload = run_benchmark(
        methods=methods,
        quick_samples=args.quick_samples,
        heavy_samples=args.heavy_samples,
        confirm=confirm,
        with_telemetry_smoke=args.telemetry_smoke,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
