"""Offline, deterministic load model and measurement schema for Task 1.

The command exercises synthetic payloads only. It does not start Electron,
connect to a service, read user files, or write into the source tree.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

SCALE_FACTORS = {"1x": 1, "5x": 5, "10x": 10}
BASE_COUNTS = {
    "json_documents": 20,
    "sqlite_records": 100,
    "espacios_tasks": 25,
    "users": 10,
    "spreadsheet_rows": 100,
    "images": 20,
    "canvas_documents": 10,
    "concurrent_jobs": 8,
}
LOAD_UNITS = {
    "json_documents": "synthetic JSON documents",
    "sqlite_records": "synthetic SQLite-shaped records",
    "espacios_tasks": "synthetic Espacios tasks",
    "users": "synthetic user records",
    "spreadsheet_rows": "synthetic spreadsheet rows",
    "images": "synthetic image payload descriptors",
    "canvas_documents": "synthetic Canvas documents",
    "concurrent_jobs": "synthetic queued jobs",
}


def _validate_scale(scale: str) -> int:
    try:
        return SCALE_FACTORS[scale]
    except KeyError as exc:
        raise ValueError(f"scale must be one of {sorted(SCALE_FACTORS)}") from exc


def generate_fixtures(scale: str, *, seed: int = 1) -> dict[str, Any]:
    """Return deterministic, non-sensitive fixtures for every load domain."""
    factor = _validate_scale(scale)
    counts = {domain: count * factor for domain, count in BASE_COUNTS.items()}
    fixtures: dict[str, Any] = {"scale": scale, "seed": seed, "counts": counts, "data": {}}
    for domain, count in counts.items():
        fixtures["data"][domain] = [
            {
                "id": f"synthetic-{domain}-{seed}-{index:04d}",
                "value": f"fixture-{(seed + index) % 997:03d}",
                "unit": LOAD_UNITS[domain],
            }
            for index in range(count)
        ]
    return fixtures


def _nearest_rank(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    rank = max(1, int((quantile * len(ordered)) + 0.999999999))
    return ordered[rank - 1]


class MetricCollector:
    """Collect one scenario's measurements without depending on a service."""

    def __init__(self, domain: str, scale: str) -> None:
        _validate_scale(scale)
        self.domain = domain
        self.scale = scale
        self._durations: list[float] = []
        self._totals = {"ipc_bytes": 0, "request_count": 0, "lock_wait_ms": 0.0, "queue_wait_ms": 0.0, "errors": 0}

    def observe(
        self,
        *,
        duration_ms: float,
        ipc_bytes: int = 0,
        request_count: int = 0,
        lock_wait_ms: float = 0.0,
        queue_wait_ms: float = 0.0,
        errors: int = 0,
    ) -> None:
        if duration_ms < 0 or min(ipc_bytes, request_count, errors) < 0:
            raise ValueError("measurements cannot be negative")
        self._durations.append(float(duration_ms))
        self._totals["ipc_bytes"] += ipc_bytes
        self._totals["request_count"] += request_count
        self._totals["lock_wait_ms"] += lock_wait_ms
        self._totals["queue_wait_ms"] += queue_wait_ms
        self._totals["errors"] += errors

    def finish(self, *, peak_rss_bytes: int) -> dict[str, Any]:
        if not self._durations:
            raise ValueError("at least one observation is required")
        latency = {key: round(_nearest_rank(self._durations, quantile), 3) for key, quantile in (("p50", 0.5), ("p95", 0.95), ("p99", 0.99))}
        return {
            "domain": self.domain,
            "scale": self.scale,
            "samples": len(self._durations),
            "latency_ms": latency,
            "peak_rss_bytes": peak_rss_bytes,
            **{key: round(value, 3) if isinstance(value, float) else value for key, value in self._totals.items()},
        }


def runtime_metadata() -> dict[str, str]:
    return {"python": platform.python_version(), "platform": platform.platform(), "machine": platform.machine(), "runtime": sys.implementation.name}


def _peak_rss_bytes() -> int:
    try:
        import psutil

        return int(psutil.Process(os.getpid()).memory_info().rss)
    except (ImportError, OSError):
        return 0


def run_offline_baseline(scale: str, *, seed: int = 1) -> dict[str, Any]:
    fixtures = generate_fixtures(scale, seed=seed)
    measurements: list[dict[str, Any]] = []
    for domain, items in fixtures["data"].items():
        collector = MetricCollector(domain, scale)
        for item in items:
            started = time.perf_counter_ns()
            encoded = json.dumps(item, sort_keys=True, separators=(",", ":")).encode("utf-8")
            json.loads(encoded)
            duration_ms = (time.perf_counter_ns() - started) / 1_000_000
            collector.observe(duration_ms=duration_ms, ipc_bytes=len(encoded) * 2, request_count=1)
        measurements.append(collector.finish(peak_rss_bytes=_peak_rss_bytes()))
    return serialize_result(fixtures=fixtures, measurements=measurements, metadata=runtime_metadata())


def serialize_result(*, fixtures: dict[str, Any], measurements: list[dict[str, Any]], metadata: dict[str, str]) -> dict[str, Any]:
    return {"schema_version": 1, "mode": "offline-synthetic", "fixtures": fixtures, "measurements": measurements, "metadata": metadata}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the offline synthetic scalability baseline")
    parser.add_argument("--scale", choices=sorted(SCALE_FACTORS), default="1x")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--output", type=Path, help="JSON artifact path (default: temporary directory)")
    args = parser.parse_args()
    result = run_offline_baseline(args.scale, seed=args.seed)
    output = args.output
    if output is None:
        output = Path(tempfile.mkdtemp(prefix="antares-scalability-")) / f"baseline-{args.scale}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
