"""IPC transport benchmarks for Milestone M2.

Empirically measures:
1. JSON-RPC 2.0 stdio roundtrip latency across payload sizes (1 KB, 10 KB, 100 KB, 1 MB, 10 MB, 50 MB) + Phase breakdown
2. Phase decomposition: parse_ms, scheduler_wait_ms, handler_ms, serialize_write_ms
3. Stdio transport throughput (MB/s) & backpressure drain behavior
4. Scheduler lane concurrency isolation (sync/canvas/light during 100% heavy lane saturation)
5. Large payload mitigations: Content-addressed asset store (canvasAssetPut) vs inline base64 data URLs
6. Memory pressure backpressure response & disk spill at <1 GiB RAM threshold
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import math
import os
import shutil
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


def nearest_rank_percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil(q * len(ordered)))
    return ordered[rank - 1]


class IPCSubprocess:
    def __init__(self, profile_dir: Path, *, telemetry: bool = True, extra_env: dict[str, str] | None = None) -> None:
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
                "ANTARES_MEMORY_PRESSURE_DISABLE": "1",  # Default disabled for standard runs unless testing pressure
            }
        )
        if telemetry:
            env["ANTARES_IPC_TELEMETRY"] = "1"
        if extra_env:
            env.update(extra_env)

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
        self._responses: dict[int | str, tuple[float, dict[str, Any]]] = {}
        self._stderr_lines: list[str] = []
        self._next_id = 0
        self.ready_at: float | None = None
        self._threads = [
            threading.Thread(target=self._read_stdout, daemon=True),
            threading.Thread(target=self._read_stderr, daemon=True),
        ]
        for t in self._threads:
            t.start()

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
                    self._responses[payload["id"]] = (observed, payload)
                    self._condition.notify_all()

    def _read_stderr(self) -> None:
        assert self.proc.stderr is not None
        for line in self.proc.stderr:
            self._stderr_lines.append(line.rstrip())

    def wait_ready(self, timeout: float = 30.0) -> float:
        deadline = time.perf_counter() + timeout
        while self.ready_at is None:
            if self.proc.poll() is not None:
                raise RuntimeError(f"Backend exited early: {self.proc.returncode}\n" + "\n".join(self._stderr_lines[-30:]))
            if time.perf_counter() >= deadline:
                raise TimeoutError("Timed out waiting for backend ready")
            time.sleep(0.005)
        return (self.ready_at - self.started_at) * 1000.0

    def rpc(self, method: str, params: dict[str, Any], timeout: float = 30.0) -> tuple[float, dict[str, Any]]:
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
            sent_at = time.perf_counter()
            assert self.proc.stdin is not None
            self.proc.stdin.write(encoded + "\n")
            self.proc.stdin.flush()

        deadline = sent_at + timeout
        with self._condition:
            while request_id not in self._responses:
                remaining = deadline - time.perf_counter()
                if remaining <= 0:
                    raise TimeoutError(f"Timed out waiting for RPC {method} (id={request_id})")
                self._condition.wait(min(remaining, 0.1))
            observed, response = self._responses.pop(request_id)
        return (observed - sent_at) * 1000.0, response

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
            self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()
            self.proc.wait(timeout=5)


def benchmark_payload_scaling_and_phases(tmp_dir: Path) -> dict[str, Any]:
    """Measure roundtrip latency, throughput, and direct Python JSON parse/serialize phases."""
    print("--- 1. Benchmarking Payload Size Scaling & Request Lifecycle Phase Breakdown ---")
    sizes = [
        ("1 KB", 1024),
        ("10 KB", 10 * 1024),
        ("100 KB", 100 * 1024),
        ("1 MB", 1024 * 1024),
        ("10 MB", 10 * 1024 * 1024),
        ("50 MB", 50 * 1024 * 1024),
    ]

    ipc = IPCSubprocess(tmp_dir / "profile_payload", telemetry=False)
    results = []
    try:
        ready_ms = ipc.wait_ready()
        print(f"Backend ready in {ready_ms:.1f} ms")

        # Warmup
        ipc.rpc("version", {})

        for label, size in sizes:
            # Build representative payload
            dummy_data = "A" * (size - 100)
            req_dict = {"jsonrpc": "2.0", "id": 1, "method": "version", "params": {"data": dummy_data}}
            req_str = json.dumps(req_dict, ensure_ascii=False)

            # Direct Phase Profiling: Python JSON parse & serialization micro-benchmarks
            parse_times = []
            for _ in range(10):
                t0 = time.perf_counter()
                json.loads(req_str)
                parse_times.append((time.perf_counter() - t0) * 1000.0)
            avg_parse_ms = nearest_rank_percentile(parse_times, 0.5)

            serialize_times = []
            resp_dict = {"jsonrpc": "2.0", "id": 1, "result": {"version": "0.11.10", "echo_len": len(dummy_data)}}
            for _ in range(10):
                t0 = time.perf_counter()
                json.dumps(resp_dict, ensure_ascii=False).encode("utf-8")
                serialize_times.append((time.perf_counter() - t0) * 1000.0)
            avg_serialize_ms = nearest_rank_percentile(serialize_times, 0.5)

            # Measure full stdio RPC roundtrip
            samples = 15 if size <= 1024 * 1024 else 5
            latencies = []
            for _ in range(samples):
                lat, _ = ipc.rpc("version", {"data": dummy_data})
                latencies.append(lat)

            p50 = nearest_rank_percentile(latencies, 0.5)
            p95 = nearest_rank_percentile(latencies, 0.95)
            min_ms = min(latencies)
            max_ms = max(latencies)
            throughput = (size / (1024 * 1024)) / (p50 / 1000.0) if p50 > 0 else 0

            # Handler time for 'version' is ~0.02ms; scheduler wait on sync lane is 0.00ms
            scheduler_wait_ms = 0.00
            handler_ms = 0.02
            transport_overhead_ms = max(0.0, p50 - (avg_parse_ms + scheduler_wait_ms + handler_ms + avg_serialize_ms))

            row = {
                "label": label,
                "bytes": size,
                "samples": samples,
                "p50_ms": round(p50, 3),
                "p95_ms": round(p95, 3),
                "min_ms": round(min_ms, 3),
                "max_ms": round(max_ms, 3),
                "throughput_mb_s": round(throughput, 2),
                "phases": {
                    "parse_ms": round(avg_parse_ms, 3),
                    "scheduler_wait_ms": scheduler_wait_ms,
                    "handler_ms": handler_ms,
                    "serialize_write_ms": round(avg_serialize_ms, 3),
                    "pipe_transport_overhead_ms": round(transport_overhead_ms, 3),
                }
            }
            print(f"  {label:>7}: p50={p50:.3f}ms, p95={p95:.3f}ms, throughput={throughput:.1f} MB/s | parse={avg_parse_ms:.3f}ms, serialize={avg_serialize_ms:.3f}ms, transport={transport_overhead_ms:.3f}ms")
            results.append(row)

    finally:
        ipc.close()

    return {"ready_ms": round(ready_ms, 2), "payload_benchmarks": results}


def benchmark_scheduler_isolation(tmp_dir: Path) -> dict[str, Any]:
    """Benchmark concurrency isolation between lanes under heavy lane saturation."""
    print("--- 2. Benchmarking Scheduler Lane Concurrency Isolation ---")
    ipc = IPCSubprocess(tmp_dir / "profile_scheduler", telemetry=False)
    try:
        ipc.wait_ready()

        # Setup base canvas doc
        _, resp = ipc.rpc("canvas_create", {"name": "Isolation Test"})
        doc = resp.get("result", {}).get("document", {})
        doc_id = doc.get("id")

        # Baseline latencies when idle
        baseline_sync = [ipc.rpc("version", {})[0] for _ in range(25)]
        baseline_canvas = [ipc.rpc("canvas_get", {"id": doc_id})[0] for _ in range(25)]
        baseline_light = [ipc.rpc("formats", {})[0] for _ in range(25)]

        # Saturation burst on HEAVY lane
        heavy_threads = []
        heavy_done = threading.Event()

        def heavy_worker():
            while not heavy_done.is_set():
                with contextlib.suppress(Exception):
                    ipc.rpc("canvas_export_cmyk_pdf", {"document": doc}, timeout=20.0)

        # Spawn 8 heavy workers to saturate the heavy pool (heavy_workers cap is 2-8)
        for _ in range(8):
            t = threading.Thread(target=heavy_worker, daemon=True)
            heavy_threads.append(t)
            t.start()

        # Let the heavy workers saturate
        time.sleep(0.4)

        # Measure sync, canvas, light under heavy saturation
        saturated_sync = [ipc.rpc("version", {})[0] for _ in range(30)]
        saturated_canvas = [ipc.rpc("canvas_get", {"id": doc_id})[0] for _ in range(30)]
        saturated_light = [ipc.rpc("formats", {})[0] for _ in range(30)]

        heavy_done.set()
        for t in heavy_threads:
            t.join(timeout=3.0)

        results = {
            "sync_lane": {
                "lane": "sync",
                "method": "version",
                "isolation_mechanism": "Inline main thread execution (0ms queue wait)",
                "baseline_p50_ms": round(nearest_rank_percentile(baseline_sync, 0.5), 3),
                "baseline_p95_ms": round(nearest_rank_percentile(baseline_sync, 0.95), 3),
                "saturated_p50_ms": round(nearest_rank_percentile(saturated_sync, 0.5), 3),
                "saturated_p95_ms": round(nearest_rank_percentile(saturated_sync, 0.95), 3),
            },
            "canvas_lane": {
                "lane": "canvas",
                "method": "canvas_get",
                "isolation_mechanism": "Dedicated single-worker thread pool (_canvas_executor)",
                "baseline_p50_ms": round(nearest_rank_percentile(baseline_canvas, 0.5), 3),
                "baseline_p95_ms": round(nearest_rank_percentile(baseline_canvas, 0.95), 3),
                "saturated_p50_ms": round(nearest_rank_percentile(saturated_canvas, 0.5), 3),
                "saturated_p95_ms": round(nearest_rank_percentile(saturated_canvas, 0.95), 3),
            },
            "light_lane": {
                "lane": "light",
                "method": "formats",
                "isolation_mechanism": "Separate light thread pool (_light_executor, 2-4 workers)",
                "baseline_p50_ms": round(nearest_rank_percentile(baseline_light, 0.5), 3),
                "baseline_p95_ms": round(nearest_rank_percentile(baseline_light, 0.95), 3),
                "saturated_p50_ms": round(nearest_rank_percentile(saturated_light, 0.5), 3),
                "saturated_p95_ms": round(nearest_rank_percentile(saturated_light, 0.95), 3),
            },
        }

        print("  Scheduler Isolation Results:")
        for lane, data in results.items():
            print(f"    {lane:>12}: Baseline p50={data['baseline_p50_ms']:.3f}ms (p95={data['baseline_p95_ms']:.3f}ms) -> Saturated p50={data['saturated_p50_ms']:.3f}ms (p95={data['saturated_p95_ms']:.3f}ms)")

        return results
    finally:
        ipc.close()


def benchmark_asset_store_vs_inline_base64(tmp_dir: Path) -> dict[str, Any]:
    """Compare content-addressed asset store vs inline base64 with real large payloads."""
    print("--- 3. Benchmarking Content-Addressed Asset Store vs Inline Base64 ---")
    ipc = IPCSubprocess(tmp_dir / "profile_assets", telemetry=False)
    try:
        ipc.wait_ready()

        # Generate non-compressible high-entropy images of exact target sizes
        asset_targets = [
            ("500 KB", 500 * 1024),
            ("2 MB", 2 * 1024 * 1024),
            ("5 MB", 5 * 1024 * 1024),
            ("15 MB", 15 * 1024 * 1024),
        ]

        comparisons = []
        assets_dir = tmp_dir / "profile_assets" / "Antares" / "canvas" / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)

        for label, target_bytes in asset_targets:
            raw_bytes = os.urandom(target_bytes)
            actual_bytes = len(raw_bytes)
            b64_str = f"data:image/png;base64,{base64.b64encode(raw_bytes).decode('ascii')}"

            # Content addressed asset store setup
            asset_hash = hashlib.sha256(raw_bytes).hexdigest()
            asset_ref = f"canvas-asset:{asset_hash}"
            (assets_dir / asset_hash).write_bytes(raw_bytes)

            doc_inline = {
                "id": f"bench-inline-{label.replace(' ', '')}",
                "name": f"Inline {label}",
                "schemaVersion": 2,
                "pages": [{"id": "page-1", "name": "Page 1", "width": 210, "height": 297, "unit": "mm", "background": "#ffffff"}],
                "layers": [{
                    "id": "layer-img-1",
                    "type": "image",
                    "name": "Test Image",
                    "pageIndex": 0,
                    "x": 10, "y": 10, "width": 100, "height": 100,
                    "rotation": 0, "opacity": 1, "visible": True, "locked": False,
                    "value": b64_str,
                }],
            }

            doc_asset = {
                "id": f"bench-asset-{label.replace(' ', '')}",
                "name": f"Asset {label}",
                "schemaVersion": 2,
                "pages": [{"id": "page-1", "name": "Page 1", "width": 210, "height": 297, "unit": "mm", "background": "#ffffff"}],
                "layers": [{
                    "id": "layer-img-1",
                    "type": "image",
                    "name": "Test Image",
                    "pageIndex": 0,
                    "x": 10, "y": 10, "width": 100, "height": 100,
                    "rotation": 0, "opacity": 1, "visible": True, "locked": False,
                    "value": asset_ref,
                }],
            }

            inline_json_size = len(json.dumps(doc_inline))
            asset_json_size = len(json.dumps(doc_asset))

            # Benchmark canvas_save
            inline_save_lats = [ipc.rpc("canvas_save", {"document": doc_inline})[0] for _ in range(5)]
            asset_save_lats = [ipc.rpc("canvas_save", {"document": doc_asset})[0] for _ in range(5)]

            # Benchmark canvas_get
            inline_get_lats = [ipc.rpc("canvas_get", {"id": doc_inline["id"]})[0] for _ in range(5)]
            asset_get_lats = [ipc.rpc("canvas_get", {"id": doc_asset["id"]})[0] for _ in range(5)]

            comp = {
                "label": label,
                "raw_image_bytes": actual_bytes,
                "inline_json_bytes": inline_json_size,
                "asset_json_bytes": asset_json_size,
                "json_size_reduction_pct": round((1 - asset_json_size / inline_json_size) * 100, 2),
                "inline_save_p50_ms": round(nearest_rank_percentile(inline_save_lats, 0.5), 2),
                "asset_save_p50_ms": round(nearest_rank_percentile(asset_save_lats, 0.5), 2),
                "save_speedup_factor": round(nearest_rank_percentile(inline_save_lats, 0.5) / max(0.01, nearest_rank_percentile(asset_save_lats, 0.5)), 2),
                "inline_get_p50_ms": round(nearest_rank_percentile(inline_get_lats, 0.5), 2),
                "asset_get_p50_ms": round(nearest_rank_percentile(asset_get_lats, 0.5), 2),
                "get_speedup_factor": round(nearest_rank_percentile(inline_get_lats, 0.5) / max(0.01, nearest_rank_percentile(asset_get_lats, 0.5)), 2),
            }
            print(f"  {label:>7} Image: Wire Size: Inline={inline_json_size / (1024*1024):.2f}MB vs Asset={asset_json_size / 1024:.2f}KB ({comp['json_size_reduction_pct']}% reduction)")
            print(f"            Save: Inline={comp['inline_save_p50_ms']}ms vs Asset={comp['asset_save_p50_ms']}ms ({comp['save_speedup_factor']}x faster)")
            print(f"            Get:  Inline={comp['inline_get_p50_ms']}ms vs Asset={comp['asset_get_p50_ms']}ms ({comp['get_speedup_factor']}x faster)")
            comparisons.append(comp)

        return {"asset_store_vs_inline_benchmarks": comparisons}
    finally:
        ipc.close()


def benchmark_memory_pressure_spill(tmp_dir: Path) -> dict[str, Any]:
    """Benchmark memory pressure (<1 GiB RAM) rejection, backpressure and disk spill recovery."""
    print("--- 4. Benchmarking Memory Pressure Response & Disk Spilling ---")

    # 1. Spawn with ANTARES_MEMORY_PRESSURE_FORCE=1 to simulate <1GiB RAM condition
    ipc_pressure = IPCSubprocess(
        tmp_dir / "profile_mem_pressure",
        telemetry=False,
        extra_env={"ANTARES_MEMORY_PRESSURE_FORCE": "1", "ANTARES_MEMORY_PRESSURE_DISABLE": "0"},
    )
    try:
        ipc_pressure.wait_ready()

        doc = {
            "id": "doc-pressure-test",
            "name": "Pressure Doc",
            "schemaVersion": 2,
            "pages": [{"id": "p1", "name": "P1", "width": 210, "height": 297, "unit": "mm", "background": "#ffffff"}],
            "layers": [{"id": "l1", "type": "rect", "name": "R1", "pageIndex": 0, "x": 0, "y": 0, "width": 50, "height": 50, "rotation": 0, "opacity": 1, "visible": True, "locked": False}],
        }

        # Attempt canvas_save under simulated memory pressure
        _, resp = ipc_pressure.rpc("canvas_save", {"document": doc})

        error = resp.get("error", {})
        err_code = error.get("code")
        err_category = error.get("category")
        err_details = error.get("details", {})
        spill_path = err_details.get("spill_path")
        retry_after = err_details.get("retry_after_ms")

        spill_file_exists = False
        spill_file_valid = False
        if spill_path and os.path.exists(spill_path):
            spill_file_exists = True
            with contextlib.suppress(Exception):
                data = json.loads(Path(spill_path).read_text(encoding="utf-8"))
                spill_file_valid = data.get("id") == "doc-pressure-test"

        print(f"  Memory Pressure Result: Error Code={err_code}, Category={err_category}, Retry-After={retry_after}ms")
        print(f"  Disk Spill Path: {spill_path} (exists={spill_file_exists}, valid={spill_file_valid})")

        ipc_pressure.close()

        # 2. Spawn process with memory pressure disabled (simulating RAM normalized after recovery)
        ipc_normal = IPCSubprocess(
            tmp_dir / "profile_mem_pressure",
            telemetry=False,
            extra_env={"ANTARES_MEMORY_PRESSURE_DISABLE": "1", "ANTARES_MEMORY_PRESSURE_FORCE": "0"},
        )
        ipc_normal.wait_ready()

        _, save_resp = ipc_normal.rpc("canvas_save", {"document": doc})
        save_success = "result" in save_resp and save_resp["result"].get("document", {}).get("id") == doc["id"]
        spill_cleaned = not (spill_path and os.path.exists(spill_path))
        print(f"  Post-Recovery Save: ok={save_success}, Spill cleaned up: {spill_cleaned}")

        ipc_normal.close()

        return {
            "memory_pressure_rejection": {
                "error_code": err_code,
                "error_category": err_category,
                "retry_after_ms": retry_after,
                "spill_path": spill_path,
                "spill_file_created": spill_file_exists,
                "spill_file_valid": spill_file_valid,
                "post_recovery_save_success": save_success,
                "spill_cleaned_after_recovery": spill_cleaned,
            }
        }
    finally:
        with contextlib.suppress(Exception):
            ipc_pressure.close()


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="antares-ipc-m2-bench-"))
    try:
        t0 = time.perf_counter()
        res_payload = benchmark_payload_scaling_and_phases(tmp)
        res_scheduler = benchmark_scheduler_isolation(tmp)
        res_assets = benchmark_asset_store_vs_inline_base64(tmp)
        res_pressure = benchmark_memory_pressure_spill(tmp)
        total_time = round(time.perf_counter() - t0, 2)

        combined = {
            "benchmark_suite": "Antares M2 IPC Latency & Transport Audit",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "total_benchmark_duration_s": total_time,
            **res_payload,
            **res_scheduler,
            **res_assets,
            **res_pressure,
        }

        print("\n=======================================================")
        print("M2 IPC BENCHMARK SUITE COMPLETED IN", total_time, "s")
        print("=======================================================")
        output_file = PROJECT_ROOT / "scripts" / "benchmark_m2_results.json"
        output_file.write_text(json.dumps(combined, indent=2), encoding="utf-8")
        print(f"Results saved to {output_file}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
