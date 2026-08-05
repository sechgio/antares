"""Benchmark the Formatos PDF page preview without persistent side effects."""

from __future__ import annotations

import argparse
import io
import json
import math
import statistics
import sys
import tempfile
import threading
import time
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from typing import Any

import psutil
from pypdf import PdfWriter

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.core import formatos  # noqa: E402


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[index]


def _make_a4_pdf(path: Path) -> None:
    writer = PdfWriter()
    writer.add_blank_page(width=595.0, height=842.0)
    buffer = io.BytesIO()
    writer.write(buffer)
    path.write_bytes(buffer.getvalue())


def _measure_call(call: Callable[[], dict[str, Any]]) -> tuple[dict[str, Any], float, int]:
    process = psutil.Process()
    baseline_rss = process.memory_info().rss
    peak_rss = baseline_rss
    stop = threading.Event()

    def sample() -> None:
        nonlocal peak_rss
        while not stop.wait(0.002):
            try:
                peak_rss = max(peak_rss, process.memory_info().rss)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                return

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    started = time.perf_counter_ns()
    try:
        result = call()
    finally:
        elapsed_ms = (time.perf_counter_ns() - started) / 1_000_000.0
        with suppress(psutil.NoSuchProcess, psutil.AccessDenied):
            peak_rss = max(peak_rss, process.memory_info().rss)
        stop.set()
        sampler.join(timeout=1.0)
    return result, elapsed_ms, max(0, peak_rss - baseline_rss)


def _measure_warm_sequence(
    call: Callable[[], dict[str, Any]],
    samples: int,
) -> tuple[dict[str, Any], list[float], int, int]:
    """Measure all warm calls against one RSS baseline and sampler."""
    process = psutil.Process()
    baseline_rss = process.memory_info().rss
    peak_rss = baseline_rss
    stop = threading.Event()

    def sample() -> None:
        nonlocal peak_rss
        while not stop.wait(0.002):
            try:
                peak_rss = max(peak_rss, process.memory_info().rss)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                return

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    elapsed_values: list[float] = []
    result: dict[str, Any] = {}
    try:
        for _ in range(samples):
            started = time.perf_counter_ns()
            result = call()
            elapsed_values.append((time.perf_counter_ns() - started) / 1_000_000.0)
    finally:
        with suppress(psutil.NoSuchProcess, psutil.AccessDenied):
            peak_rss = max(peak_rss, process.memory_info().rss)
        stop.set()
        sampler.join(timeout=1.0)
    try:
        final_rss = process.memory_info().rss
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        final_rss = baseline_rss
    return (
        result,
        elapsed_values,
        max(0, peak_rss - baseline_rss),
        final_rss - baseline_rss,
    )


def run(samples: int, max_width: int) -> dict[str, Any]:
    if samples < 1:
        raise ValueError("samples must be at least 1")
    if max_width < 1:
        raise ValueError("max_width must be at least 1")

    process = psutil.Process()
    rss_initial = process.memory_info().rss
    format_id = "__benchmark_preview__"

    with tempfile.TemporaryDirectory(prefix="antares-formatos-preview-") as tmp:
        temp_dir = Path(tmp)
        pdf_path = temp_dir / "benchmark.pdf"
        _make_a4_pdf(pdf_path)

        old_uploads_dir = formatos._UPLOADS_DIR
        with formatos._formats_lock:
            old_entry = formatos._formats.get(format_id)
            formatos._UPLOADS_DIR = temp_dir
            formatos._formats[format_id] = {
                "id": format_id,
                "nombre": "Benchmark",
                "origen": "uploaded",
                "storage_path": pdf_path.name,
                "enabled": True,
                "persisted": False,
                "strategy": formatos.SIMPLE_OVERLAY,
                "mapping": None,
                "filename_pattern": "benchmark_{desde}.pdf",
                "max_pages": 1,
                "number_min": 1,
                "number_max": 1,
                "has_mapping": False,
            }

        try:
            def render() -> dict[str, Any]:
                return formatos.render_template_page(format_id, 1, max_width=max_width)

            _cold_result, cold_ms, cold_rss_delta = _measure_call(render)
            warm_result, warm_ms, warm_rss_delta, warm_final_rss_delta = (
                _measure_warm_sequence(render, samples)
            )
        finally:
            with formatos._formats_lock:
                formatos._UPLOADS_DIR = old_uploads_dir
                if old_entry is None:
                    formatos._formats.pop(format_id, None)
                else:
                    formatos._formats[format_id] = old_entry

    mib = 1024.0 * 1024.0
    return {
        "samples": samples,
        "max_width": max_width,
        "cold_ms": round(cold_ms, 3),
        "warm_p50_ms": round(statistics.median(warm_ms), 3),
        "warm_p95_ms": round(_percentile(warm_ms, 0.95), 3),
        "rss_initial_mib": round(rss_initial / mib, 3),
        "cold_rss_delta_mib": round(cold_rss_delta / mib, 3),
        "warm_peak_rss_delta_mib": round(warm_rss_delta / mib, 3),
        "warm_final_rss_delta_mib": round(warm_final_rss_delta / mib, 3),
        "rendered_width": warm_result["rendered_width"],
        "rendered_height": warm_result["rendered_height"],
        "render_dpi": warm_result["render_dpi"],
        "mime_type": warm_result["mime_type"],
        "response_keys": sorted(warm_result),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--max-width", type=int, default=1200)
    args = parser.parse_args()
    print(json.dumps(run(args.samples, args.max_width), indent=2))


if __name__ == "__main__":
    main()
