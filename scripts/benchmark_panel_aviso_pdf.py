"""Microbenchmark for panel aviso / write_pdf_sanitized warm latency.

Prints JSON only; no repository writes.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.core.panel_aviso_corte.models import Panel, PanelImageRef  # noqa: E402
from backend.core.panel_aviso_corte.rendering import render_pdf  # noqa: E402
from backend.utils import pdf_html  # noqa: E402
from backend.utils.html_sanitizer import sanitize_html_for_pdf  # noqa: E402
from backend.utils.pdf_html import write_pdf_sanitized  # noqa: E402


def _percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(q * len(ordered)) - 1)]


def _panel_html() -> str:
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><style>"
        "@page { size: A4; margin: 1cm; }"
        "body { font-family: Arial, sans-serif; }"
        "h1 { font-size: 14pt; }"
        "</style></head><body>"
        "<h1>AVISO DE CORTE</h1>"
        "<p>Cuadrante A-12 · Fecha 2026-08-05 · Motivo mantenimiento</p>"
        "</body></html>"
    )


def _measure(call, samples: int) -> dict[str, float]:
    # Primera / cold
    started = time.perf_counter_ns()
    call()
    first_ms = (time.perf_counter_ns() - started) / 1_000_000.0
    warm: list[float] = []
    for _ in range(samples):
        started = time.perf_counter_ns()
        call()
        warm.append((time.perf_counter_ns() - started) / 1_000_000.0)
    return {
        "first_ms": round(first_ms, 3),
        "warm_p50_ms": round(statistics.median(warm), 3),
        "warm_p95_ms": round(_percentile(warm, 0.95), 3),
        "n": samples,
    }


def _measure_phases(html: str, samples: int) -> dict[str, object]:
    """Time sanitize vs WeasyPrint for an identical repeated payload."""
    from io import BytesIO

    from weasyprint import HTML

    pdf_html.reset_pdf_cache_for_tests()
    sanitize_ms: list[float] = []
    weasy_ms: list[float] = []
    cached_ms: list[float] = []

    # Cold WeasyPrint path once (no cache yet).
    cleaned = sanitize_html_for_pdf(html)
    buf = BytesIO()
    t0 = time.perf_counter_ns()
    HTML(
        string=cleaned,
        url_fetcher=pdf_html.deny_external_url_fetcher,
    ).write_pdf(buf, font_config=pdf_html._thread_font_config())
    cold_weasy_ms = (time.perf_counter_ns() - t0) / 1_000_000.0

    # Warm phase split without cache helper.
    for _ in range(samples):
        t0 = time.perf_counter_ns()
        cleaned = sanitize_html_for_pdf(html)
        sanitize_ms.append((time.perf_counter_ns() - t0) / 1_000_000.0)
        buf = BytesIO()
        t0 = time.perf_counter_ns()
        HTML(
            string=cleaned,
            url_fetcher=pdf_html.deny_external_url_fetcher,
        ).write_pdf(buf, font_config=pdf_html._thread_font_config())
        weasy_ms.append((time.perf_counter_ns() - t0) / 1_000_000.0)

    # Cached path: first call fills LRU, remaining are hits.
    pdf_html.reset_pdf_cache_for_tests()
    write_pdf_sanitized(html)
    for _ in range(samples):
        t0 = time.perf_counter_ns()
        write_pdf_sanitized(html)
        cached_ms.append((time.perf_counter_ns() - t0) / 1_000_000.0)

    return {
        "cold_weasyprint_ms": round(cold_weasy_ms, 3),
        "sanitize_p50_ms": round(statistics.median(sanitize_ms), 3),
        "sanitize_p95_ms": round(_percentile(sanitize_ms, 0.95), 3),
        "weasyprint_p50_ms": round(statistics.median(weasy_ms), 3),
        "weasyprint_p95_ms": round(_percentile(weasy_ms, 0.95), 3),
        "cached_write_p50_ms": round(statistics.median(cached_ms), 3),
        "cached_write_p95_ms": round(_percentile(cached_ms, 0.95), 3),
        "n": samples,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=30)
    args = parser.parse_args()

    html = _panel_html()
    pdf_html.reset_pdf_cache_for_tests()
    write_stats = _measure(lambda: write_pdf_sanitized(html), args.samples)
    phases = _measure_phases(html, args.samples)

    panel = Panel(
        cuadrante="A-12",
        fecha_corte="2026-08-05",
        motivo="Mantenimiento",
        imagenes=(
            PanelImageRef(
                filename="img1.jpg",
                caption="IMAGEN N°1: Calle 1",
                position=1,
            ),
        ),
        source_row_index=0,
    )
    pdf_html.reset_pdf_cache_for_tests()
    render_stats = _measure(
        lambda: render_pdf(
            panels=(panel,),
            logos={},
            images={},
            export_mode="include_empty",
        ),
        args.samples,
    )
    print(
        json.dumps(
            {
                "write_pdf_sanitized": write_stats,
                "phases_identical_payload": phases,
                "render_pdf": render_stats,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
