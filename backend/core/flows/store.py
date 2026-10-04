"""Persistencia JSON de flujos y sus ejecuciones.

Los documentos viven en ``<datos de usuario>/flows/``: un ``flows.json`` con
un flujo por id y un ``flow_runs.json`` con el historial de runs acotado por
flujo. Mismo patrón que los stores JSON de informes: escritura atómica y
normalización en carga.
"""

from __future__ import annotations

import logging
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.core.flows.schema import normalize_graph, validate_graph
from backend.core.flows.types import JsonObject
from backend.utils.atomic_write import atomic_write_json
from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)

MAX_RUNS_PER_FLOW = 25
MAX_TOTAL_RUNS = 200

_RUN_STATUSES = frozenset({"queued", "running", "success", "error", "cancelled"})


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _normalize_flow(raw: JsonObject) -> JsonObject | None:
    flow_id = raw.get("id")
    graph = raw.get("graph")
    if not isinstance(flow_id, str) or not flow_id or not isinstance(graph, dict):
        return None
    try:
        graph = normalize_graph(graph)
    except ValueError:
        return None
    name = raw.get("name")
    return {
        "id": flow_id,
        "name": str(name) if isinstance(name, str) and name else "Sin nombre",
        "description": str(raw["description"]) if isinstance(raw.get("description"), str) else "",
        "enabled": raw.get("enabled") is not False,
        "graph": graph,
        "created_at": str(raw.get("created_at") or ""),
        "updated_at": str(raw.get("updated_at") or ""),
        "last_run_status": raw.get("last_run_status") if raw.get("last_run_status") in _RUN_STATUSES else None,
        "last_run_at": str(raw.get("last_run_at") or "") or None,
        "last_scheduled_at": str(raw.get("last_scheduled_at") or "") or None,
    }


def _normalize_run(raw: JsonObject) -> JsonObject | None:
    run_id = raw.get("id")
    flow_id = raw.get("flow_id")
    status = raw.get("status")
    if not isinstance(run_id, str) or not isinstance(flow_id, str) or status not in _RUN_STATUSES:
        return None
    steps = raw.get("steps")
    if not isinstance(steps, list):
        steps = []
    graph = raw.get("graph")
    return {
        "id": run_id,
        "flow_id": flow_id,
        "flow_name": str(raw.get("flow_name") or ""),
        "status": status,
        "graph": dict(graph) if isinstance(graph, dict) else {},
        "trigger_payload": raw.get("trigger_payload") if isinstance(raw.get("trigger_payload"), dict) else {},
        "steps": [s for s in steps if isinstance(s, dict)],
        "error": str(raw["error"]) if isinstance(raw.get("error"), str) else None,
        "created_at": str(raw.get("created_at") or ""),
        "started_at": str(raw.get("started_at") or "") or None,
        "finished_at": str(raw.get("finished_at") or "") or None,
    }


class FlowStore:
    def __init__(self, flows_path: Path | None = None, runs_path: Path | None = None) -> None:
        self._flows_path = flows_path or user_data_path("flows/flows.json")
        self._runs_path = runs_path or user_data_path("flows/flow_runs.json")
        self._lock = threading.RLock()
        runs = self._read_runs()
        interrupted = [run for run in runs.values() if run["status"] in ("queued", "running")]
        if interrupted:
            finished_at = _utc_now()
            for run in interrupted:
                run.update(
                    status="error",
                    error="Ejecución interrumpida al reiniciar el backend",
                    finished_at=finished_at,
                )
            self._write_runs(runs)
            interrupted_ids = {run["id"] for run in interrupted}
            for flow_id in {run["flow_id"] for run in interrupted}:
                latest = max(
                    (run for run in runs.values() if run["flow_id"] == flow_id),
                    key=lambda run: run["created_at"],
                )
                if latest["id"] in interrupted_ids:
                    self._touch_last_run(flow_id, "error", finished_at)

    def _read(self, path: Path, normalizer: Any) -> dict[str, JsonObject]:
        if not path.exists():
            return {}
        import json

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("Store de flujos corrupto en %s; se trata como vacío", path)
            return {}
        if not isinstance(raw, dict):
            return {}
        items: dict[str, JsonObject] = {}
        for item_id, item in raw.items():
            if not isinstance(item, dict):
                continue
            normalized = normalizer(item)
            if normalized is not None:
                items[str(item_id)] = normalized
        return items

    def _read_flows(self) -> dict[str, JsonObject]:
        return self._read(self._flows_path, _normalize_flow)

    def _read_runs(self) -> dict[str, JsonObject]:
        return self._read(self._runs_path, _normalize_run)

    def _write_flows(self, flows: dict[str, JsonObject]) -> None:
        atomic_write_json(self._flows_path, flows)

    def _write_runs(self, runs: dict[str, JsonObject]) -> None:
        ordered = sorted(runs.values(), key=lambda r: r.get("created_at") or "", reverse=True)
        per_flow: dict[str, int] = {}
        kept: list[JsonObject] = []
        for run in ordered:
            if run.get("status") in ("queued", "running"):
                kept.append(run)
                continue
            fid = run["flow_id"]
            count = per_flow.get(fid, 0)
            if count >= MAX_RUNS_PER_FLOW or len(kept) >= MAX_TOTAL_RUNS:
                continue
            per_flow[fid] = count + 1
            kept.append(run)
        atomic_write_json(self._runs_path, {r["id"]: r for r in kept})

    def list_flows(self) -> list[JsonObject]:
        with self._lock:
            flows = self._read_flows()
        metas = []
        for flow in flows.values():
            metas.append({k: v for k, v in flow.items() if k != "graph"})
        metas.sort(key=lambda f: f.get("updated_at") or "", reverse=True)
        return metas

    def get(self, flow_id: str) -> JsonObject | None:
        with self._lock:
            flow = self._read_flows().get(flow_id)
        return deepcopy(flow) if flow is not None else None

    def create(self, name: str, graph: JsonObject | None = None, description: str = "") -> JsonObject:
        if graph is None:
            graph = {
                "nodes": [
                    {
                        "id": "trigger",
                        "kind": "trigger",
                        "name": "Inicio",
                        "config": {"trigger_kind": "manual"},
                        "position": {"x": 80.0, "y": 160.0},
                    }
                ],
                "edges": [],
            }
        graph = normalize_graph(graph)
        validate_graph(graph)
        now = _utc_now()
        flow: JsonObject = {
            "id": uuid.uuid4().hex[:12],
            "name": name or "Sin nombre",
            "description": description,
            "enabled": True,
            "graph": graph,
            "created_at": now,
            "updated_at": now,
            "last_run_status": None,
            "last_run_at": None,
        }
        with self._lock:
            flows = self._read_flows()
            flows[flow["id"]] = flow
            self._write_flows(flows)
        return deepcopy(flow)

    def update(
        self,
        flow_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        enabled: bool | None = None,
        graph: JsonObject | None = None,
        expected_updated_at: str | None = None,
    ) -> JsonObject | None:
        with self._lock:
            flows = self._read_flows()
            flow = flows.get(flow_id)
            if flow is None:
                return None
            if expected_updated_at is not None and flow.get("updated_at") != expected_updated_at:
                raise ValueError("El flujo fue modificado por otra sesión; recarga antes de guardar")
            if name is not None:
                flow["name"] = str(name)
            if description is not None:
                flow["description"] = str(description)
            if enabled is not None:
                flow["enabled"] = bool(enabled)
            if graph is not None:
                normalized = normalize_graph(graph)
                validate_graph(normalized)
                flow["graph"] = normalized
            flow["updated_at"] = _utc_now()
            self._write_flows(flows)
            return deepcopy(flow)

    def delete(self, flow_id: str) -> bool:
        with self._lock:
            flows = self._read_flows()
            if flow_id not in flows:
                return False
            del flows[flow_id]
            self._write_flows(flows)
            runs = self._read_runs()
            remaining = {rid: r for rid, r in runs.items() if r["flow_id"] != flow_id}
            if len(remaining) != len(runs):
                self._write_runs(remaining)
        return True

    def duplicate(self, flow_id: str, name: str | None = None) -> JsonObject | None:
        source = self.get(flow_id)
        if source is None:
            return None
        return self.create(
            name or f"{source['name']} (copia)",
            graph=source["graph"],
            description=source.get("description") or "",
        )

    def touch_scheduled_run(self, flow_id: str, run_at: str) -> None:
        """Marca la última vez que el planificador disparó el flujo."""
        with self._lock:
            flows = self._read_flows()
            flow = flows.get(flow_id)
            if flow is None:
                return
            flow["last_scheduled_at"] = run_at
            self._write_flows(flows)

    def _touch_last_run(self, flow_id: str, status: str, run_at: str) -> None:
        with self._lock:
            flows = self._read_flows()
            flow = flows.get(flow_id)
            if flow is None:
                return
            flow["last_run_status"] = status
            flow["last_run_at"] = run_at
            self._write_flows(flows)

    def create_run(self, flow_id: str, trigger_payload: JsonObject | None = None) -> JsonObject | None:
        flow = self.get(flow_id)
        if flow is None:
            return None
        run = {
            "id": uuid.uuid4().hex[:12],
            "flow_id": flow_id,
            "flow_name": flow["name"],
            "status": "queued",
            "graph": deepcopy(flow.get("graph") or {}),
            "trigger_payload": dict(trigger_payload or {}),
            "steps": [],
            "error": None,
            "created_at": _utc_now(),
            "started_at": None,
            "finished_at": None,
        }
        with self._lock:
            runs = self._read_runs()
            runs[run["id"]] = run
            self._write_runs(runs)
        self._touch_last_run(flow_id, "queued", run["created_at"])
        return deepcopy(run)

    def update_run(self, run_id: str, **fields: Any) -> JsonObject | None:
        with self._lock:
            runs = self._read_runs()
            run = runs.get(run_id)
            if run is None:
                return None
            for key in ("status", "error", "started_at", "finished_at"):
                if key in fields:
                    value = fields[key]
                    run[key] = str(value) if value is not None else None
            if "steps" in fields and isinstance(fields["steps"], list):
                run["steps"] = [s for s in fields["steps"] if isinstance(s, dict)]
            if "trigger_payload" in fields and isinstance(fields["trigger_payload"], dict):
                run["trigger_payload"] = dict(fields["trigger_payload"])
            self._write_runs(runs)
            if "status" in fields:
                self._touch_last_run(run["flow_id"], str(fields["status"]), run.get("finished_at") or _utc_now())
            return deepcopy(run)

    def get_run(self, run_id: str) -> JsonObject | None:
        with self._lock:
            run = self._read_runs().get(run_id)
        return deepcopy(run) if run is not None else None

    def list_runs(self, flow_id: str | None = None, limit: int = 50) -> list[JsonObject]:
        with self._lock:
            runs = list(self._read_runs().values())
        if flow_id is not None:
            runs = [r for r in runs if r["flow_id"] == flow_id]
        runs.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return [deepcopy(r) for r in runs[:limit]]
