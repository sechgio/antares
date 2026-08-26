"""Tests for the offline scalability baseline model."""

from __future__ import annotations

import json

from scripts.scalability_baseline import (
    BASE_COUNTS,
    SCALE_FACTORS,
    MetricCollector,
    generate_fixtures,
    run_offline_baseline,
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


def test_offline_baseline_executes_all_named_scenarios_with_representative_fixtures() -> None:
    result = run_offline_baseline("1x", seed=17)

    assert result["mode"] == "offline-synthetic"
    assert {measurement["scenario"] for measurement in result["measurements"]} == {
        "conversion",
        "list",
        "export",
        "spreadsheet",
        "canvas_sync",
        "espacios",
        "autoimg",
    }
    fixtures = result["fixtures"]["data"]
    assert set(fixtures) == set(BASE_COUNTS)
    assert fixtures["json_documents"][0]["blocks"][0]["type"] == "heading"
    assert fixtures["sqlite_records"][0]["table"] == "conversion_history"
    assert fixtures["espacios_tasks"][0]["assignee_id"].startswith("synthetic-user-")
    assert fixtures["users"][0]["preferences"]["locale"] == "es-PE"
    assert fixtures["spreadsheet_rows"][0]["cells"]["amount"] == 100.0
    assert fixtures["images"][0]["payload"]["byte_length"] > 0
    assert fixtures["canvas_documents"][0]["pages"][0]["layers"][0]["type"] == "text"
    assert fixtures["concurrent_jobs"][0]["operation"] == "autoimg"
    assert {domain for measurement in result["measurements"] for domain in measurement["fixture_domains"]} == set(BASE_COUNTS)
    payloads = {measurement["scenario"]: measurement["representative_payload"] for measurement in result["measurements"]}
    assert payloads["conversion"] == {
        "estimated_output_bytes": 76800,
        "input": "image-0000.png",
        "job_id": "synthetic-job-17-0000",
        "output_mime": "image/webp",
    }
    assert payloads["list"]["target_format"] == "jpeg"
    assert payloads["export"]["block_types"] == ["heading", "table", "paragraph"]
    assert payloads["spreadsheet"]["tax_cents"] == 1800
    assert payloads["canvas_sync"]["next_revision"] == 2
    assert payloads["espacios"]["assignee"]["display_name"] == "Synthetic User 0000"
    assert payloads["autoimg"]["source_checksum"] == "synthetic-checksum-017-0000"


def test_offline_baseline_at_ten_x_samples_rss_and_records_job_waits_with_bounded_payload() -> None:
    sampled_rss = iter((128, 256, 512) * 5_000)
    result = run_offline_baseline("10x", seed=3, rss_sampler=lambda: next(sampled_rss))

    encoded = json.dumps(result, sort_keys=True).encode("utf-8")
    assert len(encoded) < 64 * 1024 * 1024
    assert result["fixtures"]["counts"] == {
        domain: count * SCALE_FACTORS["10x"] for domain, count in BASE_COUNTS.items()
    }
    assert {measurement["peak_rss_bytes"] for measurement in result["measurements"]} == {512}
    for measurement in result["measurements"]:
        assert measurement["samples"] > 0
        assert measurement["ipc_bytes"] > 0
        assert measurement["request_count"] > 0
        assert measurement["errors"] >= 0
        assert measurement["lock_wait_ms"] >= 0
        assert measurement["queue_wait_ms"] >= 0
        assert measurement["latency_ms"]["p50"] >= 0
        assert measurement["latency_ms"]["p95"] >= measurement["latency_ms"]["p50"]
        assert measurement["latency_ms"]["p99"] >= measurement["latency_ms"]["p95"]
    autoimg = next(measurement for measurement in result["measurements"] if measurement["scenario"] == "autoimg")
    assert autoimg["lock_wait_ms"] > 0
    assert autoimg["queue_wait_ms"] > 0
    assert {"cpu_model", "cpu_count", "memory_total_bytes", "memory_available_bytes"} <= set(result["metadata"])
    assert result["metadata"]["cpu_count"] >= 0
    assert result["metadata"]["memory_total_bytes"] >= 0
    assert result["metadata"]["memory_available_bytes"] >= 0
