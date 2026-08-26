"""Tests for the offline scalability baseline model."""

from __future__ import annotations

import json

from scripts.scalability_baseline import (
    SCALE_FACTORS,
    MetricCollector,
    generate_fixtures,
    serialize_result,
)


def test_fixture_generation_is_deterministic_and_scales_all_domains() -> None:
    first = generate_fixtures("5x", seed=17)
    second = generate_fixtures("5x", seed=17)

    assert first == second
    assert first["scale"] == "5x"
    assert first["counts"] == {
        domain: count * SCALE_FACTORS["5x"]
        for domain, count in generate_fixtures("1x", seed=17)["counts"].items()
    }
    assert all("@" not in value for value in json.dumps(first))


def test_metric_collection_has_required_percentiles_and_counters() -> None:
    collector = MetricCollector("json_documents", "1x")
    collector.observe(duration_ms=3.0, ipc_bytes=12, request_count=1, lock_wait_ms=0.5, queue_wait_ms=1.0)
    collector.observe(duration_ms=7.0, ipc_bytes=20, request_count=2, errors=1)

    result = collector.finish(peak_rss_bytes=1234)

    assert result["latency_ms"] == {"p50": 3.0, "p95": 7.0, "p99": 7.0}
    assert result["peak_rss_bytes"] == 1234
    assert result["ipc_bytes"] == 32
    assert result["request_count"] == 3
    assert result["lock_wait_ms"] == 0.5
    assert result["queue_wait_ms"] == 1.0
    assert result["errors"] == 1


def test_serialization_is_json_safe_and_preserves_metadata() -> None:
    collector = MetricCollector("images", "10x")
    collector.observe(duration_ms=1.25)
    payload = serialize_result(
        fixtures=generate_fixtures("10x", seed=1),
        measurements=[collector.finish(peak_rss_bytes=99)],
        metadata={"python": "3.14-test", "machine": "synthetic"},
    )

    encoded = json.dumps(payload, sort_keys=True)
    decoded = json.loads(encoded)
    assert decoded["metadata"]["machine"] == "synthetic"
    assert decoded["measurements"][0]["scale"] == "10x"
    assert decoded["measurements"][0]["latency_ms"]["p99"] == 1.25
