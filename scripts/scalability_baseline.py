
from __future__ import annotations

import argparse
import json
import os
import platform
import queue
import sys
import tempfile
import threading
import time
from collections.abc import Callable
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
MAX_SERIALIZED_PAYLOAD_BYTES = 64 * 1024 * 1024
MAX_RECORDED_ERRORS = 100
Clock = Callable[[], float]
RssSampler = Callable[[], int]


def _validate_scale(scale: str) -> int:
    try:
        return SCALE_FACTORS[scale]
    except KeyError as exc:
        raise ValueError(f"scale must be one of {sorted(SCALE_FACTORS)}") from exc


def _synthetic_id(domain: str, seed: int, index: int) -> str:
    return f"synthetic-{domain}-{seed}-{index:04d}"


def _json_documents(count: int, seed: int) -> list[dict[str, Any]]:
    return [
        {
            "id": _synthetic_id("document", seed, index),
            "title": f"Synthetic document {index:04d}",
            "revision": (index % 5) + 1,
            "tags": ["offline", "baseline", f"group-{index % 4}"],
            "metadata": {"owner_id": _synthetic_id("user", seed, index % max(1, count)), "archived": index % 9 == 0},
            "blocks": [
                {"id": f"block-{index}-title", "type": "heading", "text": f"Heading {index:04d}"},
                {
                    "id": f"block-{index}-table",
                    "type": "table",
                    "columns": ["label", "value"],
                    "rows": [["sample", index], ["seed", seed]],
                },
                {"id": f"block-{index}-note", "type": "paragraph", "text": "Offline synthetic fixture."},
            ],
        }
        for index in range(count)
    ]


def _sqlite_records(count: int, seed: int) -> list[dict[str, Any]]:
    return [
        {
            "table": "conversion_history",
            "primary_key": _synthetic_id("history", seed, index),
            "columns": {
                "source_name": f"source-{index:04d}.png",
                "target_format": "webp" if index % 2 else "jpeg",
                "input_bytes": 120_000 + index * 37,
                "output_bytes": 72_000 + index * 23,
                "status": "completed" if index % 13 else "queued",
            },
            "created_at": f"2025-01-{(index % 28) + 1:02d}T12:00:00Z",
        }
        for index in range(count)
    ]


def _users(count: int, seed: int) -> list[dict[str, Any]]:
    return [
        {
            "id": _synthetic_id("user", seed, index),
            "display_name": f"Synthetic User {index:04d}",
            "role": "editor" if index % 3 else "admin",
            "active": index % 11 != 0,
            "preferences": {"locale": "es-PE", "theme": "dark" if index % 2 else "light"},
        }
        for index in range(count)
    ]


def _espacios_tasks(count: int, seed: int, user_count: int) -> list[dict[str, Any]]:
    return [
        {
            "id": _synthetic_id("task", seed, index),
            "board_id": _synthetic_id("board", seed, index % 3),
            "assignee_id": _synthetic_id("user", seed, index % user_count),
            "title": f"Synthetic task {index:04d}",
            "status": ("todo", "doing", "done")[index % 3],
            "priority": ("low", "medium", "high")[index % 3],
            "labels": ["offline", f"team-{index % 4}"],
            "checklist": {"completed": index % 5, "total": 5},
        }
        for index in range(count)
    ]


def _spreadsheet_rows(count: int, seed: int) -> list[dict[str, Any]]:
    return [
        {
            "row_number": index + 2,
            "cells": {
                "account": f"ACCT-{seed:03d}-{index:04d}",
                "amount": 100.0 + index * 1.25,
                "tax_rate": 0.18,
                "active": index % 7 != 0,
                "date": f"2025-02-{(index % 28) + 1:02d}",
            },
            "formulas": {"tax": f"=B{index + 2}*C{index + 2}", "total": f"=B{index + 2}+D{index + 2}"},
        }
        for index in range(count)
    ]


def _images(count: int, seed: int) -> list[dict[str, Any]]:
    return [
        {
            "id": _synthetic_id("image", seed, index),
            "filename": f"image-{index:04d}.png",
            "mime_type": "image/png",
            "width": 1600 + (index % 4) * 160,
            "height": 900 + (index % 3) * 120,
            "orientation": "landscape",
            "payload": {
                "byte_length": 128_000 + index * 211,
                "checksum": f"synthetic-checksum-{seed:03d}-{index:04d}",
                "color_space": "sRGB",
            },
        }
        for index in range(count)
    ]


def _canvas_documents(count: int, seed: int) -> list[dict[str, Any]]:
    return [
        {
            "id": _synthetic_id("canvas", seed, index),
            "version": 2,
            "revision": index + 1,
            "pages": [
                {
                    "id": f"page-{index}-1",
                    "size": {"width": 794, "height": 1123, "unit": "px"},
                    "layers": [
                        {"id": f"layer-{index}-text", "type": "text", "text": f"Synthetic title {index}"},
                        {"id": f"layer-{index}-rect", "type": "rect", "fill": "#155e75", "x": 40, "y": 80},
                        {"id": f"layer-{index}-image", "type": "imageSlot", "image_id": _synthetic_id("image", seed, index)},
                    ],
                }
            ],
        }
        for index in range(count)
    ]


def _concurrent_jobs(count: int, seed: int, image_count: int) -> list[dict[str, Any]]:
    return [
        {
            "id": _synthetic_id("job", seed, index),
            "operation": "autoimg",
            "source_image_id": _synthetic_id("image", seed, index % image_count),
            "queue_position": index,
            "options": {"target_mime": "image/webp", "quality": 82, "strip_metadata": True},
        }
        for index in range(count)
    ]


def generate_fixtures(scale: str, *, seed: int = 1) -> dict[str, Any]:
    factor = _validate_scale(scale)
    counts = {domain: count * factor for domain, count in BASE_COUNTS.items()}
    data = {
        "json_documents": _json_documents(counts["json_documents"], seed),
        "sqlite_records": _sqlite_records(counts["sqlite_records"], seed),
        "espacios_tasks": _espacios_tasks(counts["espacios_tasks"], seed, counts["users"]),
        "users": _users(counts["users"], seed),
        "spreadsheet_rows": _spreadsheet_rows(counts["spreadsheet_rows"], seed),
        "images": _images(counts["images"], seed),
        "canvas_documents": _canvas_documents(counts["canvas_documents"], seed),
        "concurrent_jobs": _concurrent_jobs(counts["concurrent_jobs"], seed, counts["images"]),
    }
    return {"scale": scale, "seed": seed, "counts": counts, "data": data}


def _nearest_rank(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    rank = max(1, int((quantile * len(ordered)) + 0.999999999))
    return ordered[rank - 1]


class MetricCollector:

    def __init__(self, domain: str, scale: str) -> None:
        _validate_scale(scale)
        self.domain = domain
        self.scale = scale
        self._durations: list[float] = []
        self._totals = {"ipc_bytes": 0, "request_count": 0, "lock_wait_ms": 0.0, "queue_wait_ms": 0.0, "errors": 0}
        self._partial = False

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
        self._totals["errors"] = min(MAX_RECORDED_ERRORS, self._totals["errors"] + errors)
        self._partial = self._partial or errors > 0

    def finish(
        self,
        *,
        peak_rss_bytes: int,
        fixture_domains: tuple[str, ...] = (),
        representative_payload: dict[str, Any] | None = None,
        capacity: dict[str, int] | None = None,
    ) -> dict[str, Any]:
        if not self._durations:
            raise ValueError("at least one observation is required")
        latency = {
            key: round(_nearest_rank(self._durations, quantile), 3)
            for key, quantile in (("p50", 0.5), ("p95", 0.95), ("p99", 0.99))
        }
        return {
            "domain": self.domain,
            "scenario": self.domain,
            "scale": self.scale,
            "samples": len(self._durations),
            "latency_ms": latency,
            "peak_rss_bytes": max(0, int(peak_rss_bytes)),
            "fixture_domains": list(fixture_domains),
            "representative_payload": representative_payload or {},
            "partial": self._partial,
            "capacity": capacity or {},
            **{key: round(value, 3) if isinstance(value, float) else value for key, value in self._totals.items()},
        }


class RssPeakTracker:

    def __init__(self, sampler: RssSampler) -> None:
        self._sampler = sampler
        self.peak_rss_bytes = 0
        self.observe()

    def observe(self) -> None:
        try:
            self.peak_rss_bytes = max(self.peak_rss_bytes, max(0, int(self._sampler())))
        except (OSError, TypeError, ValueError):
            return


def runtime_metadata() -> dict[str, Any]:
    memory_total_bytes = 0
    memory_available_bytes = 0
    try:
        import psutil
    except ImportError:
        pass
    else:
        try:
            memory = psutil.virtual_memory()
            memory_total_bytes = int(memory.total)
            memory_available_bytes = int(memory.available)
        except (OSError, psutil.Error):
            pass
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "runtime": sys.implementation.name,
        "cpu_model": platform.processor() or platform.uname().processor or "unavailable",
        "cpu_count": os.cpu_count() or 0,
        "memory_total_bytes": memory_total_bytes,
        "memory_available_bytes": memory_available_bytes,
    }


def _peak_rss_bytes() -> int:
    try:
        import psutil
    except ImportError:
        return 0
    try:
        return int(psutil.Process(os.getpid()).memory_info().rss)
    except (OSError, psutil.Error):
        return 0


def _measure_scenario(
    scenario: str,
    scale: str,
    items: list[dict[str, Any]],
    fixture_domains: tuple[str, ...],
    transform: Callable[[dict[str, Any]], dict[str, Any]],
    *,
    clock: Clock,
    rss_sampler: RssSampler,
    lock_wait_ms: float = 0.0,
    queue_wait_ms: float = 0.0,
    capacity: dict[str, int] | None = None,
) -> dict[str, Any]:
    collector = MetricCollector(scenario, scale)
    tracker = RssPeakTracker(rss_sampler)
    representative_payload: dict[str, Any] = {}
    for index, item in enumerate(items):
        started = clock()
        try:
            payload = transform(item)
            encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
            decoded = json.loads(encoded)
        except Exception:
            collector.observe(
                duration_ms=max(0.0, (clock() - started) * 1_000),
                request_count=1,
                lock_wait_ms=lock_wait_ms if index == 0 else 0.0,
                queue_wait_ms=queue_wait_ms if index == 0 else 0.0,
                errors=1,
            )
        else:
            collector.observe(
                duration_ms=max(0.0, (clock() - started) * 1_000),
                ipc_bytes=len(encoded) * 2,
                request_count=1,
                lock_wait_ms=lock_wait_ms if index == 0 else 0.0,
                queue_wait_ms=queue_wait_ms if index == 0 else 0.0,
            )
            if not representative_payload:
                representative_payload = decoded
        finally:
            tracker.observe()
    return collector.finish(
        peak_rss_bytes=tracker.peak_rss_bytes,
        fixture_domains=fixture_domains,
        representative_payload=representative_payload,
        capacity=capacity,
    )


def run_conversion_scenario(fixtures: dict[str, Any], scale: str, *, clock: Clock, rss_sampler: RssSampler) -> dict[str, Any]:
    images = {image["id"]: image for image in fixtures["images"]}
    items = [{"job": job, "image": images[job["source_image_id"]]} for job in fixtures["concurrent_jobs"]]
    return _measure_scenario(
        "conversion",
        scale,
        items,
        ("images", "concurrent_jobs"),
        lambda item: {
            "job_id": item["job"]["id"],
            "input": item["image"]["filename"],
            "output_mime": item["job"]["options"]["target_mime"],
            "estimated_output_bytes": item["image"]["payload"]["byte_length"] * 3 // 5,
        },
        clock=clock,
        rss_sampler=rss_sampler,
    )


def run_list_scenario(fixtures: dict[str, Any], scale: str, *, clock: Clock, rss_sampler: RssSampler) -> dict[str, Any]:
    return _measure_scenario(
        "list",
        scale,
        fixtures["sqlite_records"],
        ("sqlite_records",),
        lambda record: {
            "id": record["primary_key"],
            "status": record["columns"]["status"],
            "target_format": record["columns"]["target_format"],
            "bytes": record["columns"]["output_bytes"],
        },
        clock=clock,
        rss_sampler=rss_sampler,
    )


def run_export_scenario(fixtures: dict[str, Any], scale: str, *, clock: Clock, rss_sampler: RssSampler) -> dict[str, Any]:
    return _measure_scenario(
        "export",
        scale,
        fixtures["json_documents"],
        ("json_documents",),
        lambda document: {
            "document_id": document["id"],
            "content_type": "application/json",
            "revision": document["revision"],
            "block_types": [block["type"] for block in document["blocks"]],
        },
        clock=clock,
        rss_sampler=rss_sampler,
    )


def run_spreadsheet_scenario(fixtures: dict[str, Any], scale: str, *, clock: Clock, rss_sampler: RssSampler) -> dict[str, Any]:
    return _measure_scenario(
        "spreadsheet",
        scale,
        fixtures["spreadsheet_rows"],
        ("spreadsheet_rows",),
        lambda row: {
            "row_number": row["row_number"],
            "account": row["cells"]["account"],
            "amount_cents": round(row["cells"]["amount"] * 100),
            "tax_cents": round(row["cells"]["amount"] * row["cells"]["tax_rate"] * 100),
            "active": row["cells"]["active"],
        },
        clock=clock,
        rss_sampler=rss_sampler,
    )


def run_canvas_sync_scenario(fixtures: dict[str, Any], scale: str, *, clock: Clock, rss_sampler: RssSampler) -> dict[str, Any]:
    return _measure_scenario(
        "canvas_sync",
        scale,
        fixtures["canvas_documents"],
        ("canvas_documents",),
        lambda document: {
            "document_id": document["id"],
            "base_revision": document["revision"],
            "next_revision": document["revision"] + 1,
            "changed_layer_ids": [layer["id"] for layer in document["pages"][0]["layers"]],
        },
        clock=clock,
        rss_sampler=rss_sampler,
    )


def run_espacios_scenario(fixtures: dict[str, Any], scale: str, *, clock: Clock, rss_sampler: RssSampler) -> dict[str, Any]:
    users = {user["id"]: user for user in fixtures["users"]}
    return _measure_scenario(
        "espacios",
        scale,
        fixtures["espacios_tasks"],
        ("espacios_tasks", "users"),
        lambda task: {
            "task_id": task["id"],
            "board_id": task["board_id"],
            "status": task["status"],
            "assignee": {key: users[task["assignee_id"]][key] for key in ("id", "display_name", "role")},
            "checklist": task["checklist"],
        },
        clock=clock,
        rss_sampler=rss_sampler,
    )


def _measure_autoimg_waits(clock: Clock) -> tuple[float, float, int, int]:
    lock = threading.Lock()
    lock_held = threading.Event()
    contender_started = threading.Event()
    release_lock = threading.Event()
    lock_waits: list[float] = []

    def hold_lock() -> None:
        with lock:
            lock_held.set()
            release_lock.wait(timeout=1.0)

    def contend_for_lock() -> None:
        contender_started.set()
        started = clock()
        with lock:
            lock_waits.append(max(0.0, (clock() - started) * 1_000))

    holder = threading.Thread(target=hold_lock)
    holder.start()
    if not lock_held.wait(timeout=1.0):
        raise RuntimeError("offline lock holder did not start")
    contender = threading.Thread(target=contend_for_lock)
    contender.start()
    if not contender_started.wait(timeout=1.0):
        raise RuntimeError("offline lock contender did not start")
    time.sleep(0.002)
    release_lock.set()
    holder.join(timeout=1.0)
    contender.join(timeout=1.0)
    if holder.is_alive() or contender.is_alive():
        raise RuntimeError("offline lock measurement did not finish")

    jobs: queue.Queue[str] = queue.Queue(maxsize=1)
    queue_ready = threading.Event()
    queue_contender_started = threading.Event()
    release_queue = threading.Event()
    queue_waits: list[float] = []

    def dequeue_job() -> None:
        queue_ready.set()
        release_queue.wait(timeout=1.0)
        jobs.get()

    def enqueue_job() -> None:
        queue_contender_started.set()
        started = clock()
        jobs.put("synthetic-job-2")
        queue_waits.append(max(0.0, (clock() - started) * 1_000))

    worker = threading.Thread(target=dequeue_job)
    worker.start()
    if not queue_ready.wait(timeout=1.0):
        raise RuntimeError("offline queue worker did not start")
    jobs.put("synthetic-job-1")
    queue_maxsize = jobs.maxsize
    queue_peak_depth = jobs.qsize()
    contender = threading.Thread(target=enqueue_job)
    contender.start()
    if not queue_contender_started.wait(timeout=1.0):
        raise RuntimeError("offline queue contender did not start")
    time.sleep(0.002)
    release_queue.set()
    worker.join(timeout=1.0)
    contender.join(timeout=1.0)
    if worker.is_alive() or contender.is_alive():
        raise RuntimeError("offline queue measurement did not finish")
    queue_peak_depth = max(queue_peak_depth, jobs.qsize())
    jobs.get_nowait()
    return lock_waits[0], queue_waits[0], queue_maxsize, queue_peak_depth


def run_autoimg_scenario(fixtures: dict[str, Any], scale: str, *, clock: Clock, rss_sampler: RssSampler) -> dict[str, Any]:
    images = {image["id"]: image for image in fixtures["images"]}
    lock_wait_ms, queue_wait_ms, queue_maxsize, queue_peak_depth = _measure_autoimg_waits(clock)
    items = [{"job": job, "image": images[job["source_image_id"]]} for job in fixtures["concurrent_jobs"]]
    return _measure_scenario(
        "autoimg",
        scale,
        items,
        ("images", "concurrent_jobs"),
        lambda item: {
            "job_id": item["job"]["id"],
            "queue_position": item["job"]["queue_position"],
            "source_checksum": item["image"]["payload"]["checksum"],
            "target_mime": item["job"]["options"]["target_mime"],
            "quality": item["job"]["options"]["quality"],
        },
        clock=clock,
        rss_sampler=rss_sampler,
        lock_wait_ms=lock_wait_ms,
        queue_wait_ms=queue_wait_ms,
        capacity={"queue_maxsize": queue_maxsize, "queue_peak_depth": queue_peak_depth},
    )


SCENARIO_RUNNERS = {
    "conversion": run_conversion_scenario,
    "list": run_list_scenario,
    "export": run_export_scenario,
    "spreadsheet": run_spreadsheet_scenario,
    "canvas_sync": run_canvas_sync_scenario,
    "espacios": run_espacios_scenario,
    "autoimg": run_autoimg_scenario,
}


def run_offline_baseline(
    scale: str,
    *,
    seed: int = 1,
    clock: Clock = time.perf_counter,
    rss_sampler: RssSampler | None = None,
) -> dict[str, Any]:
    fixtures = generate_fixtures(scale, seed=seed)
    sampler = rss_sampler or _peak_rss_bytes
    measurements = [runner(fixtures["data"], scale, clock=clock, rss_sampler=sampler) for runner in SCENARIO_RUNNERS.values()]
    return serialize_result(fixtures=fixtures, measurements=measurements, metadata=runtime_metadata())


def serialize_result(*, fixtures: dict[str, Any], measurements: list[dict[str, Any]], metadata: dict[str, Any]) -> dict[str, Any]:
    result = {"schema_version": 1, "mode": "offline-synthetic", "fixtures": fixtures, "measurements": measurements, "metadata": metadata}
    if len(json.dumps(result, sort_keys=True, separators=(",", ":")).encode("utf-8")) >= MAX_SERIALIZED_PAYLOAD_BYTES:
        raise ValueError("offline baseline result exceeds the 64 MiB payload limit")
    return result


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
