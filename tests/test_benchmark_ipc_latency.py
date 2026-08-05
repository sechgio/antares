"""Unit tests for IPC latency benchmark helpers (no live backend spawn)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "benchmark_ipc_latency.py"


def _load_bench():
    if not SCRIPT.is_file():
        pytest.fail(f"missing benchmark script: {SCRIPT}")
    spec = importlib.util.spec_from_file_location("benchmark_ipc_latency", SCRIPT)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_nearest_rank_percentile() -> None:
    bench = _load_bench()
    values = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0]
    assert bench.nearest_rank_percentile(values, 0.50) == 50.0
    assert bench.nearest_rank_percentile(values, 0.95) == 100.0


def test_summarize_excludes_first_from_stable_percentiles() -> None:
    bench = _load_bench()
    # First is huge; stable samples are small — p95 must ignore first.
    summary = bench.summarize_latencies(
        method="version",
        first_ms=5000.0,
        stable_ms=[1.0, 2.0, 3.0, 4.0, 5.0],
        timeouts=0,
        errors=0,
        route_status="success",
    )
    assert summary["first_ms"] == 5000.0
    assert summary["n"] == 5
    assert summary["p50_ms"] == 3.0
    assert summary["p95_ms"] == 5.0
    assert summary["p95_ms"] < summary["first_ms"]


def test_registry_methods_cover_handlers() -> None:
    bench = _load_bench()
    from backend.handlers import HANDLERS

    registered = set(HANDLERS.keys())
    covered = set(bench.registry_methods())
    assert covered == registered
    assert len(covered) == 93


def test_stable_leader_requires_repeatable_success() -> None:
    bench = _load_bench()
    rows = [
        {
            "method": "noisy",
            "p95_ms": 900.0,
            "p50_ms": 5.0,
            "n": 30,
            "timeouts": 0,
            "route_status": "success",
            "p95_p50_ratio": 180.0,
        },
        {
            "method": "panel_aviso_corte_render_pdf",
            "p95_ms": 400.0,
            "p50_ms": 300.0,
            "n": 30,
            "timeouts": 0,
            "route_status": "success",
            "p95_p50_ratio": 1.33,
        },
        {
            "method": "broken",
            "p95_ms": 1000.0,
            "p50_ms": 1000.0,
            "n": 30,
            "timeouts": 0,
            "route_status": "error_path",
            "p95_p50_ratio": 1.0,
        },
    ]
    leader = bench.select_stable_leader(rows, max_p95_p50_ratio=10.0)
    assert leader is not None
    assert leader["method"] == "panel_aviso_corte_render_pdf"


def test_batch_p95_within_tolerance() -> None:
    bench = _load_bench()
    assert bench.batches_agree(100.0, 110.0, tolerance=0.15) is True
    assert bench.batches_agree(100.0, 130.0, tolerance=0.15) is False
