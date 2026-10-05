"""Ejecutor de flujos: recorre el DAG en orden topológico y mantiene una
memoria JSON única por run, como en openhuman (``item``, ``items``, ``run``
y ``nodes.<id>``).

Semántica de disparo: cada nodo recibe las salidas de sus aristas entrantes
cuyo ``from_port`` produjo datos. Un nodo se ejecuta cuando al menos una
arista entrante entregó salida; si ninguna lo hizo, queda ``skipped``. Un
nodo con error no propaga salida, así que sus ramas dependientes se saltan
pero el resto del grafo continúa.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import deque
from collections.abc import Callable
from concurrent import futures
from pathlib import Path
from typing import Any

from backend.core.flows import agent_chat, agent_node, code_exec, connections, events, mcp_servers
from backend.core.flows.cancel import RunCancelled as _RunCancelled
from backend.core.flows.cancel import await_or_cancel as _await_or_cancel
from backend.core.flows.expr import interpolate_text, resolve
from backend.core.flows.http_guard import assert_allowed_url, build_flow_opener
from backend.core.flows.schema import IMPLEMENTED_NODE_KINDS, loop_body_regions, normalize_graph, validate_graph
from backend.core.flows.store import MAX_TOTAL_RUNS, FlowStore, _utc_now
from backend.core.flows.types import JsonObject
from backend.core.ipc_catalog import (
    FLOW_ACTION_METHODS,
    ORCHESTRATABLE_METHODS,
    allows_raw_output_path,
    file_tokens_for,
    lane_for,
    timeout_ms_for,
    write_path_keys_for,
)

logger = logging.getLogger(__name__)

_MAX_STEP_OUTPUT_CHARS = 8000
_MAX_HTTP_BODY_BYTES = 512 * 1024
_HTTP_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"})

# Límite global de concurrencia: nodos en vuelo entre todos los runs y runs
# simultáneos (el resto queda en cola con estado ``queued``).
_MAX_PARALLEL_NODES = max(1, int(os.environ.get("ANTARES_FLOWS_MAX_PARALLEL") or 4))
_MAX_CONCURRENT_RUNS = max(1, int(os.environ.get("ANTARES_FLOWS_MAX_RUNS") or 3))
_NODE_SLOTS = threading.BoundedSemaphore(_MAX_PARALLEL_NODES)
_RUN_SLOTS = threading.BoundedSemaphore(_MAX_CONCURRENT_RUNS)


def _utc_ms() -> float:
    return time.time() * 1000


def _summarize(value: Any) -> Any:
    try:
        serialized = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        serialized = str(value)
    if len(serialized) > _MAX_STEP_OUTPUT_CHARS:
        return {"truncated": True, "preview": serialized[:_MAX_STEP_OUTPUT_CHARS]}
    return value


class _CancelEvent:
    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    def wait(self, timeout: float) -> bool:
        return self._event.wait(timeout)

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()


_active_runs: dict[str, _CancelEvent] = {}
_active_lock = threading.Lock()
_active_flow_ids: set[str] = set()


def _register(run_id: str) -> _CancelEvent:
    token = _CancelEvent()
    with _active_lock:
        _active_runs[run_id] = token
    return token


def _unregister(run_id: str) -> None:
    with _active_lock:
        _active_runs.pop(run_id, None)


def cancel_run(run_id: str) -> bool:
    with _active_lock:
        token = _active_runs.get(run_id)
    if token is None:
        return False
    token.cancel()
    return True


class FlowRunner:
    def __init__(self, store: FlowStore, handler_getter: Callable[[str], Any]) -> None:
        self._store = store
        self._handler_getter = handler_getter

    def start(self, flow_id: str, trigger_payload: JsonObject | None = None, *,
              acknowledge_uncertain: bool = False) -> JsonObject:
        flow = self._store.get(flow_id)
        guarded = bool(flow and any(
            n.get("config", {}).get("method") in FLOW_ACTION_METHODS - ORCHESTRATABLE_METHODS for n in flow["graph"]["nodes"]
        ))
        if guarded:
            with _active_lock:
                if flow_id in _active_flow_ids:
                    raise ValueError("Este flujo ya tiene una ejecución en curso")
                _active_flow_ids.add(flow_id)
        try:
            run = self._store.create_run(flow_id, trigger_payload, acknowledge_uncertain=acknowledge_uncertain)
        except Exception:
            with _active_lock:
                _active_flow_ids.discard(flow_id)
            raise
        if run is None:
            with _active_lock:
                _active_flow_ids.discard(flow_id)
            raise ValueError(f"Flujo no encontrado: {flow_id}")
        token = _register(run["id"])
        thread = threading.Thread(
            target=self._execute_safe,
            args=(run["id"], token, flow_id),
            name=f"flow-run-{run['id']}",
            daemon=True,
        )
        thread.start()
        return run

    def _execute_safe(self, run_id: str, token: _CancelEvent, flow_id: str) -> None:
        try:
            # Límite global de runs simultáneos: el run espera en 'queued'.
            acquired = _RUN_SLOTS.acquire(timeout=None)
            try:
                if acquired:
                    self._execute(run_id, token)
            finally:
                if acquired:
                    _RUN_SLOTS.release()
        except Exception:
            logger.exception("Fallo no controlado en run de flujo %s", run_id)
            self._store.update_run(
                run_id,
                status="error",
                error="Error interno del ejecutor de flujos",
                finished_at=_utc_now(),
            )
        finally:
            with _active_lock:
                _active_flow_ids.discard(flow_id)
            _unregister(run_id)

    def ready_to_start(self, flow: JsonObject) -> bool:
        with _active_lock:
            if flow["id"] in _active_flow_ids:
                return False
        sources = []
        last_source: JsonObject = {}
        for node in flow["graph"]["nodes"]:
            config = node.get("config") or {}
            args = config.get("args") or {}
            if not isinstance(args, dict):
                continue
            if any(args.get(key) in (None, "", []) for key in config.get("required_args") or []):
                return False
            if node.get("config", {}).get("method") != "flows_read_images":
                continue
            args = node["config"].get("args") or {}
            if any(isinstance(v, str) and v.startswith("=") for v in args.values()):
                return True
            fn = self._handler_getter("flows_read_images")
            if fn is None:
                return False
            source = fn({**args, "_flow_file_grants": node["config"].get("_file_grants") or {}})
            if not source.get("ready"):
                return False
            sources.append(source["fingerprint"])
            last_source = source
        if not sources:
            return True
        fingerprint = _source_fingerprint(flow["graph"], sources + self._template_fingerprints(flow["graph"]))
        return not _checkpoint_blocks(flow, fingerprint, _expected_output_paths(last_source, fingerprint))

    def _template_fingerprints(self, graph: JsonObject) -> list[str]:
        if not any(n.get("config", {}).get("method") == "flows_read_images" for n in graph["nodes"]):
            return []
        versions = []
        for node in graph["nodes"]:
            config = node.get("config") or {}
            args = config.get("args") or {}
            if not isinstance(args, dict):
                continue
            if config.get("method") == "flows_render_pdf":
                name = args.get("template_name")
                if args.get("expected_pages") is not None:
                    name = next((n.get("config", {}).get("args", {}).get("report_template") for n in graph["nodes"]
                                 if n.get("config", {}).get("method") == "flows_read_images"
                                 and isinstance(n.get("config", {}).get("args"), dict)
                                 and n["config"]["args"].get("report_template")), name)
                handler = self._handler_getter("template_get")
                listing = self._handler_getter("templates_list")
                if handler and listing and isinstance(name, str) and name and not name.startswith("="):
                    if name not in {t["name"] for t in listing({"recursive": True})["templates"]}:
                        raise ValueError("Selecciona una plantilla HTML de Antares")
                    versions.append(hashlib.sha256(handler({"name": name})["content"].encode()).hexdigest())
                continue
            if config.get("method") != "canvas_get":
                continue
            item_id = args.get("id")
            if not isinstance(item_id, str) or not item_id or item_id.startswith("="):
                continue
            handler = self._handler_getter("canvas_get")
            if handler:
                document = handler({"id": item_id}).get("document")
                versions.append(hashlib.sha256(json.dumps(document, sort_keys=True).encode()).hexdigest())
        return versions

    def _execute(self, run_id: str, token: _CancelEvent) -> None:
        run = self._store.get_run(run_id)
        if run is None:
            return
        try:
            graph = normalize_graph(run.get("graph") or {})
            validate_graph(graph)
        except ValueError as exc:
            self._store.update_run(run_id, status="error", error=str(exc), finished_at=_utc_now())
            return
        if token.cancelled:
            self._store.update_run(run_id, status="cancelled", finished_at=_utc_now())
            return

        # Una reanudación restaura salidas/nodos terminados desde el checkpoint.
        checkpoint = run.get("checkpoint") or {}
        nodes = {n["id"]: n for n in graph["nodes"]}
        inbound: dict[str, list[JsonObject]] = {n["id"]: [] for n in graph["nodes"]}
        outgoing: dict[str, list[JsonObject]] = {n["id"]: [] for n in graph["nodes"]}
        for edge in graph["edges"]:
            inbound[edge["to_node"]].append(edge)
            outgoing[edge["from_node"]].append(edge)
        bodies = loop_body_regions(graph)
        body_members = {nid for region in bodies.values() for nid in region}

        outputs: dict[str, JsonObject] = dict(checkpoint.get("outputs") or {})
        settled: dict[str, str] = dict(checkpoint.get("settled") or {})
        pending: dict[str, JsonObject] = dict(checkpoint.get("pending") or {})
        approvals: dict[str, JsonObject] = dict(checkpoint.get("approvals") or {})
        loop_progress: dict[str, JsonObject] = dict(checkpoint.get("loops") or {})
        steps: list[JsonObject] = [
            s for s in run.get("steps") or [] if s.get("status") not in ("running", "waiting")
        ]
        saved_mem = checkpoint.get("memory") or {}
        memory: JsonObject = {
            "run": {
                "run_id": run_id,
                "flow_id": run["flow_id"],
                "trigger": run.get("trigger_payload") or {},
            },
            "nodes": {},
            "item": None,
            "items": [],
            "graph": graph,
            "loop": {},
            "sources": list(saved_mem.get("sources") or []),
            "templates": list(saved_mem.get("templates") or self._template_fingerprints(graph)),
            "read_paths": set(saved_mem.get("read_paths") or []),
            "write_roots": set(saved_mem.get("write_roots") or []),
            "produced_paths": set(saved_mem.get("produced_paths") or []),
            "acknowledge_uncertain": bool(run.get("acknowledge_uncertain")),
        }
        for key in ("report_batch", "report_template"):
            if saved_mem.get(key):
                memory[key] = saved_mem[key]
        for nid, ports in outputs.items():
            first = next(iter(ports), None)
            if first is not None:
                memory["nodes"][nid] = ports[first]

        self._store.update_run(
            run_id, status="running", started_at=run.get("started_at") or _utc_now(), interrupted=False
        )
        lock = threading.RLock()

        def persist() -> None:
            cp = {
                "outputs": outputs,
                "settled": settled,
                "pending": pending,
                "approvals": approvals,
                "loops": loop_progress,
                "memory": {
                    "sources": memory["sources"],
                    "templates": memory["templates"],
                    "read_paths": sorted(memory["read_paths"]),
                    "write_roots": sorted(memory["write_roots"]),
                    "produced_paths": sorted(memory["produced_paths"]),
                    "report_batch": memory.get("report_batch"),
                    "report_template": memory.get("report_template"),
                },
            }
            try:
                cp = json.loads(json.dumps(cp, default=str))
            except (TypeError, ValueError):
                cp = {"pending": pending, "approvals": approvals}
            self._store.update_run(run_id, steps=list(steps), checkpoint=cp)

        schedulable = [nid for nid in nodes if nid not in body_members]
        pending_in = {nid: len(inbound[nid]) for nid in schedulable}
        ready: deque[str] = deque()
        for nid in settled:
            for edge in outgoing[nid]:
                if edge["to_node"] in pending_in:
                    pending_in[edge["to_node"]] -= 1
        for nid in schedulable:
            if pending_in[nid] == 0 and nid not in settled:
                ready.append(nid)

        in_flight: dict[futures.Future, str] = {}
        waiting_now: set[str] = set()
        any_error = any(s == "error" for s in settled.values())

        def live_items(node_id: str) -> list[Any]:
            if nodes[node_id]["kind"] == "trigger":
                return [run.get("trigger_payload") or {}]
            items = []
            for edge in inbound[node_id]:
                src = outputs.get(edge["from_node"]) or {}
                if edge["from_port"] in src:
                    items.append(src[edge["from_port"]].get("json"))
            return items

        def settle(
            node_id: str,
            status: str,
            node_outputs: JsonObject | None,
            step: JsonObject | None = None,
        ) -> None:
            nonlocal any_error
            with lock:
                if status == "error":
                    any_error = True
                if node_outputs:
                    outputs[node_id] = node_outputs
                    memory["nodes"][node_id] = node_outputs[next(iter(node_outputs))]
                settled[node_id] = status
                if step is not None:
                    steps.append(step)
                for edge in outgoing[node_id]:
                    target = edge["to_node"]
                    if target in pending_in:
                        pending_in[target] -= 1
                        if pending_in[target] == 0 and target not in settled:
                            ready.append(target)
                persist()

        ctx = {
            "run": run,
            "token": token,
            "graph": graph,
            "nodes": nodes,
            "inbound": inbound,
            "outputs": outputs,
            "bodies": bodies,
            "steps": steps,
            "lock": lock,
            "persist": persist,
            "pending": pending,
            "approvals": approvals,
            "memory": memory,
            "loop_progress": loop_progress,
        }
        pool = futures.ThreadPoolExecutor(max_workers=_MAX_PARALLEL_NODES, thread_name_prefix="flow-node")
        try:
            while not token.cancelled:
                while ready and not token.cancelled:
                    nid = ready.popleft()
                    if nid in settled or nid in waiting_now:
                        continue
                    node = nodes[nid]
                    items = live_items(nid)
                    if not items:
                        settle(nid, "skipped", None, self._step(node, "skipped"))
                        continue
                    method = (node.get("config") or {}).get("method")
                    if (method in FLOW_ACTION_METHODS - ORCHESTRATABLE_METHODS
                            and node["config"].get("input_mode", "all") == "all"
                            and len(items) < len(inbound[nid])):
                        settle(nid, "skipped", None, self._step(node, "skipped"))
                        continue
                    step = self._step(node, "running", started_at=_utc_now())
                    with lock:
                        steps.append(step)
                        persist()
                    in_flight[pool.submit(self._run_one, node, items, step, ctx)] = nid
                if not in_flight:
                    break
                done, _ = futures.wait(tuple(in_flight), timeout=0.2, return_when=futures.FIRST_COMPLETED)
                for fut in done:
                    nid = in_flight.pop(fut)
                    status, node_outputs, pending_state = fut.result()
                    if pending_state is not None:
                        aid = str(pending_state.get("approval_id") or uuid.uuid4().hex[:12])
                        pending_state["approval_id"] = aid
                        if isinstance(pending_state.get("agent_state"), dict):
                            pending_state["agent_state"]["approval_id"] = aid
                        call = pending_state.get("approval_call") or pending_state.get("pending_call") or {}
                        approvals.setdefault(aid, {
                            "id": aid,
                            "node_id": nid,
                            "node_name": nodes[nid].get("name") or nid,
                            "method": call.get("name"),
                            "params": call.get("params"),
                            "decision": None,
                            "created_at": _utc_now(),
                        })
                        pending[nid] = pending_state
                        waiting_now.add(nid)
                        with lock:
                            persist()
                    else:
                        settle(nid, status, node_outputs)
        finally:
            pool.shutdown(wait=False)

        if token.cancelled:
            self._store.update_run(run_id, status="cancelled", steps=list(steps), finished_at=_utc_now())
            return
        if pending:
            self._store.update_run(run_id, status="waiting")
            return
        actions = [s for s in steps if (nodes[s["node_id"]].get("config") or {}).get("method")
                   in FLOW_ACTION_METHODS - ORCHESTRATABLE_METHODS]
        ran = any(s["status"] == "success" for s in actions) if actions else any(
            s["status"] == "success" and nodes[s["node_id"]]["kind"] != "trigger" for s in steps)
        status = "error" if any_error else "success" if ran else "skipped"
        action_steps = [s for s in actions if (nodes[s["node_id"]].get("config") or {}).get("method") != "flows_read_images"]
        if memory["sources"] and action_steps and all(s["status"] == "success" for s in action_steps) and not any_error:
            self._store.acknowledge_source(run["flow_id"], _source_fingerprint(graph, memory["sources"] + memory["templates"]),
                                           remember=bool(memory.get("report_batch")),
                                           artifacts=sorted(memory.get("produced_paths") or ()))
        self._store.update_run(
            run_id,
            status=status,
            steps=list(steps),
            finished_at=_utc_now(),
            error="Uno o más nodos fallaron" if any_error else None,
            checkpoint=None,
        )
        # El linaje evita cadenas infinitas: un flujo no se autodispara por flow_finished.
        chain = [*((run.get("trigger_payload") or {}).get("__event_chain") or []), run["flow_id"]]
        events.emit("flow_finished", {
            "flow_id": run["flow_id"], "run_id": run_id, "status": status, "__event_chain": chain,
        })

    def _run_one(
        self,
        node: JsonObject,
        live_items: list[Any],
        step: JsonObject,
        ctx: JsonObject,
    ) -> tuple[str, JsonObject, JsonObject | None]:
        """Ejecuta un nodo bajo el límite global de concurrencia.

        Devuelve (status, outputs, pending_state): ``pending_state`` no es None
        cuando un nodo agente pidió una herramienta con efectos y el run pasa a
        ``waiting`` sin que el nodo quede ``settled``.
        """
        token: _CancelEvent = ctx["token"]
        memory = ctx["memory"]
        started = _utc_ms()
        node_memory = {
            **memory,
            "item": {"json": live_items[0]},
            "items": [{"json": i} for i in live_items],
        }
        resumed = ctx.get("pending_state") or ctx["pending"].pop(node["id"], None)
        sub_ctx = {**ctx, "pending_state": resumed}
        attempts, delay_ms = _retry_config(node)
        tried = 0
        node_outputs: JsonObject = {}
        # El bucle no retiene un slot: cada nodo del cuerpo adquiere el suyo.
        holds_slot = node["kind"] != "loop"
        try:
            if holds_slot:
                _NODE_SLOTS.acquire()
            try:
                while True:
                    if token.cancelled:
                        raise _RunCancelled()
                    tried += 1
                    try:
                        node_outputs = self._execute_node(node, node_memory, sub_ctx)
                    except (agent_node.AwaitingApproval, _RunCancelled):
                        raise
                    except Exception:
                        if tried >= attempts or token.cancelled:
                            raise
                    else:
                        if (
                            tried >= attempts
                            or token.cancelled
                            or not _retryable_http_output(node, node_outputs)
                        ):
                            break
                    if delay_ms > 0:
                        token.wait(delay_ms / 1000.0)
                if node["kind"] == "http_request" and node["config"].get("fail_on_http_error", True):
                    response = node_outputs["main"]["json"]
                    if not response["ok"]:
                        step["output"] = _summarize(response)
                        raise ValueError(f"La solicitud HTTP devolvió {response['status']}")
                if tried > 1:
                    step["attempts"] = tried
            except agent_node.AwaitingApproval as exc:
                step["status"] = "waiting"
                step["finished_at"] = _utc_now()
                step["duration_ms"] = round(_utc_ms() - started)
                with ctx["lock"]:
                    ctx["persist"]()
                return "waiting", {}, exc.state
            except _RunCancelled:
                step["status"] = "cancelled"
                step["finished_at"] = _utc_now()
                step["duration_ms"] = round(_utc_ms() - started)
                return "cancelled", {}, None
            except Exception as exc:
                logger.info("Nodo %s del run %s falló: %s", node["id"], ctx["run"]["id"], exc)
                step["status"] = "error"
                step["error"] = str(exc)[:500]
                if tried > 1:
                    step["attempts"] = tried
                step["finished_at"] = _utc_now()
                step["duration_ms"] = round(_utc_ms() - started)
                return "error", {}, None
            finally:
                if holds_slot:
                    _NODE_SLOTS.release()

            step["status"] = "success"
            if "waiting" in node_outputs:
                step["status"] = "skipped"
            step["finished_at"] = _utc_now()
            step["duration_ms"] = round(_utc_ms() - started)
            first_port = next(iter(node_outputs), "main")
            step["output"] = _summarize(node_outputs[first_port].get("json"))
            return step["status"], node_outputs, None
        except BaseException as exc:
            logger.exception("Fallo inesperado en el nodo %s", node["id"])
            step["status"] = "error"
            step["error"] = str(exc)[:500]
            step["finished_at"] = _utc_now()
            step["duration_ms"] = round(_utc_ms() - started)
            return "error", {}, None

    def resume(self, run_id: str) -> JsonObject:
        """Reanuda un run en espera (aprobaciones) o interrumpido (app cerrada)."""
        run = self._store.get_run(run_id)
        if run is None:
            raise ValueError(f"Run no encontrado: {run_id}")
        if run["status"] not in ("queued", "waiting", "running"):
            raise ValueError(f"El run {run_id} ya terminó ({run['status']})")
        with _active_lock:
            if run_id in _active_runs:
                return run
        token = _register(run_id)
        thread = threading.Thread(
            target=self._execute_safe,
            args=(run_id, token, run["flow_id"]),
            name=f"flow-resume-{run_id}",
            daemon=True,
        )
        thread.start()
        return run

    def resume_interrupted(self) -> int:
        """Reanuda los runs marcados ``interrupted`` al arrancar el backend."""
        resumed = 0
        for run in self._store.list_runs(limit=MAX_TOTAL_RUNS):
            if not run.get("interrupted"):
                continue
            try:
                self.resume(run["id"])
                resumed += 1
            except ValueError:
                continue
        return resumed

    def decide_approval(self, run_id: str, approval_id: str, approved: bool) -> JsonObject:
        run = self._store.get_run(run_id)
        if run is None:
            raise ValueError(f"Run no encontrado: {run_id}")
        if run["status"] != "waiting":
            raise ValueError("El run no está esperando una aprobación")
        checkpoint = dict(run.get("checkpoint") or {})
        approval = (checkpoint.get("approvals") or {}).get(approval_id)
        if approval is None or approval.get("decision") is not None:
            raise ValueError("Aprobación inexistente o ya decidida")
        approval["decision"] = "approved" if approved else "denied"
        approval["decided_at"] = _utc_now()
        self._store.update_run(run_id, checkpoint=checkpoint)
        self.resume(run_id)
        return dict(approval)

    @staticmethod
    def _topological_order(graph: JsonObject) -> list[str]:
        indegree = {n["id"]: 0 for n in graph["nodes"]}
        outgoing: dict[str, list[str]] = {n["id"]: [] for n in graph["nodes"]}
        for edge in graph["edges"]:
            indegree[edge["to_node"]] += 1
            outgoing[edge["from_node"]].append(edge["to_node"])
        queue = [nid for nid, deg in indegree.items() if deg == 0]
        order: list[str] = []
        while queue:
            nid = queue.pop(0)
            order.append(nid)
            for target in outgoing[nid]:
                indegree[target] -= 1
                if indegree[target] == 0:
                    queue.append(target)
        return order

    @staticmethod
    def _step(node: JsonObject, status: str, started_at: str | None = None) -> JsonObject:
        return {
            "node_id": node["id"],
            "kind": node["kind"],
            "name": node.get("name") or node["id"],
            "status": status,
            "started_at": started_at,
            "finished_at": None,
            "duration_ms": None,
            "output": None,
            "error": None,
        }

    def _execute_node(self, node: JsonObject, memory: JsonObject, ctx: JsonObject) -> JsonObject:
        kind = node["kind"]
        if kind not in IMPLEMENTED_NODE_KINDS:
            raise ValueError(f"Tipo de nodo aún no implementado: {kind}")
        if kind == "trigger":
            return {"main": {"json": memory["run"]["trigger"]}}
        if kind == "tool_call":
            result = self._run_tool_call(node, memory, ctx)
            config = node.get("config") or {}
            waits = config.get("method") in FLOW_ACTION_METHODS - ORCHESTRATABLE_METHODS or config.get("required_args")
            port = "waiting" if waits and isinstance(result.get("json"), dict) and result["json"].get("ready") is False else "main"
            return {port: result}
        if kind == "condition":
            return self._run_condition(node, memory)
        if kind == "transform":
            config = node.get("config") or {}
            output = resolve(config.get("output"), memory)
            return {"main": {"json": output}}
        if kind == "http_request":
            return {"main": self._run_http_request(node, memory, ctx["token"])}
        if kind == "agent":
            config = node.get("config") or {}
            if not config.get("tools"):
                return {"main": self._run_agent(node, memory)}
            return {"main": agent_node.run_agent_node(
                node,
                memory,
                handler_getter=self._handler_getter,
                token=ctx["token"],
                lane_submit=self._lane_submit,
                validate_paths=lambda m, a: _validate_action_paths(m, a, memory, self._store),
                is_cancelled=lambda: ctx["token"].cancelled,
                state=ctx.get("pending_state"),
                approvals=ctx["approvals"],
            )}
        if kind == "switch":
            return self._run_switch(node, memory)
        if kind == "loop":
            return self._run_loop(node, memory, ctx)
        if kind == "code":
            config = node.get("config") or {}
            code = str(config.get("code") or "")
            # El código corre con los privilegios del backend: exige aprobación
            # (una por texto de código y run) salvo config.auto_approve.
            if config.get("auto_approve") is not True:
                state = ctx.get("pending_state") or {}
                approval = ctx["approvals"].get(str(state.get("approval_id") or ""))
                if approval is None:
                    approval = next(
                        (
                            a
                            for a in ctx["approvals"].values()
                            if a.get("method") == "code" and (a.get("params") or {}).get("code") == code
                        ),
                        None,
                    )
                decision = (approval or {}).get("decision")
                if decision is None:
                    raise agent_node.AwaitingApproval(
                        {"pending_call": {"name": "code", "params": {"code": code}, "gated": True}}
                    )
                if decision != "approved":
                    raise ValueError("El usuario rechazó la ejecución del código")
            try:
                result = code_exec.run_python(
                    code,
                    {
                        "item": (memory.get("item") or {}).get("json"),
                        "items": [i.get("json") for i in memory.get("items") or []],
                        "nodes": {nid: (out or {}).get("json") for nid, out in memory["nodes"].items()},
                        "run": memory["run"],
                        "loop": memory.get("loop") or {},
                        "code": str(config.get("code") or ""),
                    },
                    float(config.get("timeout_s") or 30),
                    ctx["token"],
                )
            except code_exec.CodeCancelled as exc:
                raise _RunCancelled() from exc
            return {"main": result}
        if kind == "mcp_call":
            return {"main": mcp_servers.run_mcp_call_node(node, memory)}
        raise ValueError(f"Tipo de nodo desconocido: {kind}")

    def _lane_submit(self, name: str, fn: Callable[[JsonObject], Any], args: JsonObject) -> Any:
        from backend.core.scheduler import get_scheduler

        scheduler = get_scheduler()
        lane = lane_for(name)
        timeout_ms = timeout_ms_for(name)
        future = scheduler.submit_heavy(fn, args) if lane == "heavy" else scheduler.submit_light(fn, args)
        if future is None:
            raise ValueError(f"El planificador rechazó {name}")
        return future.result(timeout=max(1, timeout_ms / 1000))

    def _run_loop(self, node: JsonObject, memory: JsonObject, ctx: JsonObject) -> JsonObject:
        """Itera los nodos del cuerpo (puerto ``each``) por cada elemento.

        Cada iteración recibe ``item``/``items`` del cuerpo y ``loop`` (index,
        count, item) para las expresiones; los sumideros del cuerpo alimentan
        ``items`` de la salida ``done``.
        """
        config = node.get("config") or {}
        loop_id = node["id"]
        # La pausa por aprobación trae su estado completo; la reanudación tras un
        # cierre recupera el progreso persistido del checkpoint (``loops``).
        state = ctx.get("pending_state") or ctx["loop_progress"].get(loop_id) or {}
        over = config.get("over")
        raw = resolve(over, memory) if over else [entry.get("json") for entry in memory.get("items") or []]
        if not isinstance(raw, list):
            raise ValueError(f"'over' del bucle {loop_id} debe resolver a una lista")
        items = [entry.get("json") if isinstance(entry, dict) and set(entry) == {"json"} else entry
                 for entry in raw]
        max_items = int(config.get("max_items") or 100)
        items = items[:max_items]

        body_order = [nid for nid in self._topological_order(ctx["graph"]) if nid in ctx["bodies"].get(loop_id, set())]
        body_set = set(body_order)
        body_inbound = {nid: [e for e in ctx["inbound"][nid]] for nid in body_order}
        sinks = [nid for nid in body_order
                 if not any(e["to_node"] in body_set for e in ctx["graph"]["edges"] if e["from_node"] == nid)]

        collected = list(state.get("collected") or [])
        start_index = int(state.get("index") or 0)
        token: _CancelEvent = ctx["token"]
        for index in range(start_index, len(items)):
            if token.cancelled:
                raise _RunCancelled()
            element = items[index]
            iteration_outputs: dict[str, JsonObject] = dict(state.get("iteration_outputs") or {})
            body_settled: dict[str, str] = dict(state.get("body_settled") or {})
            if index > start_index or not state:
                iteration_outputs = {}
                body_settled = {}
            else:
                for _nid, _ports in iteration_outputs.items():
                    if _ports:
                        memory["nodes"][_nid] = _ports[next(iter(_ports))]
            resume_node = state.get("body_node") if index == start_index else None
            for nid in body_order:
                if nid in body_settled:
                    continue
                body_node = ctx["nodes"][nid]
                live: list[Any] = []
                for edge in body_inbound[nid]:
                    if edge["from_node"] == loop_id:
                        live.append(element)
                        continue
                    src = iteration_outputs.get(edge["from_node"]) or ctx["outputs"].get(edge["from_node"]) or {}
                    if edge["from_port"] in src:
                        live.append(src[edge["from_port"]].get("json"))
                if not live:
                    body_settled[nid] = "skipped"
                    continue
                body_memory = {
                    **memory,
                    "loop": {"index": index, "count": len(items), "item": element, "id": loop_id},
                    "nodes": {**memory["nodes"], **{b: o[next(iter(o))] for b, o in iteration_outputs.items() if o}},
                }
                step = self._step(body_node, "running", started_at=_utc_now())
                step["iteration"] = index
                with ctx["lock"]:
                    ctx["steps"].append(step)
                    ctx["persist"]()
                sub_ctx = {
                    **ctx,
                    "memory": body_memory,
                    "pending": {},
                    "pending_state": state.get("agent_state") if nid == resume_node else None,
                }
                status, node_outputs, pending_state = self._run_one(body_node, live, step, sub_ctx)
                if pending_state is not None:
                    raise agent_node.AwaitingApproval({
                        "loop_node": loop_id,
                        "index": index,
                        "collected": collected,
                        "iteration_outputs": iteration_outputs,
                        "body_settled": body_settled,
                        "body_node": nid,
                        "agent_state": pending_state,
                        "approval_call": pending_state.get("pending_call") or {},
                    })
                body_settled[nid] = status
                if node_outputs:
                    iteration_outputs[nid] = node_outputs
                    memory["nodes"][nid] = node_outputs[next(iter(node_outputs))]
                with ctx["lock"]:
                    ctx["loop_progress"][loop_id] = {
                        "index": index,
                        "collected": collected,
                        "iteration_outputs": iteration_outputs,
                        "body_settled": body_settled,
                    }
                    ctx["persist"]()
            entry: JsonObject = {"item": element}
            for nid in sinks:
                ports = iteration_outputs.get(nid)
                if ports:
                    entry[nid] = ports[next(iter(ports))].get("json")
            collected.append(entry)
            with ctx["lock"]:
                ctx["persist"]()
        with ctx["lock"]:
            ctx["loop_progress"].pop(loop_id, None)
            ctx["persist"]()
        return {"done": {"json": {"count": len(collected), "items": collected}},
                "each": {"json": {"count": len(collected)}}}

    @staticmethod
    def _run_agent(node: JsonObject, memory: JsonObject) -> JsonObject:
        config = node.get("config") or {}
        provider = str(config.get("provider") or "").strip()
        prompt = resolve(config.get("prompt"), memory)
        if isinstance(prompt, str):
            prompt = interpolate_text(prompt, memory)
        if not provider:
            raise ValueError("El nodo agent requiere config.provider")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("El nodo agent requiere config.prompt")
        default_model = agent_chat.ai_providers.public_state(provider).get("default_model", "")
        model = str(config.get("model") or default_model or "").strip()
        if not model:
            raise ValueError("El nodo agent requiere un modelo (config.model)")
        system = resolve(config.get("system"), memory)
        if isinstance(system, str):
            system = interpolate_text(system, memory)
        response = agent_chat.chat(
            provider,
            model,
            [{"role": "user", "content": prompt.strip()}],
            with_tools=False,
            system=system.strip() if isinstance(system, str) and system.strip() else None,
        )
        return {"json": {"text": response.get("text") or "", "provider": provider, "model": model}}

    @staticmethod
    def _run_switch(node: JsonObject, memory: JsonObject) -> JsonObject:
        config = node.get("config") or {}
        field = config.get("field")
        try:
            item = memory.get("item") or {}
            actual = resolve(field, memory) if field is not None else item.get("json")
        except ValueError:
            actual = None
        matched = None
        for case in config.get("cases") or []:
            if case.get("value") == actual:
                matched = str(case.get("port") or "").strip() or None
                break
        port = matched or "default"
        return {port: {"json": {"case": matched, "field": actual}}}

    def _run_tool_call(self, node: JsonObject, memory: JsonObject, ctx: JsonObject) -> JsonObject:
        config = node.get("config") or {}
        method = config.get("method")
        if method not in FLOW_ACTION_METHODS:
            raise ValueError(f"Método no orquestable: {method}")
        fn = self._handler_getter(method)
        if fn is None:
            raise ValueError(f"Handler no disponible: {method}")
        args = config.get("args")
        resolved = resolve(args, memory) if isinstance(args, dict) or (isinstance(args, str) and args.startswith("=")) else {}
        if not isinstance(resolved, dict):
            raise ValueError("Los datos de la acción deben resolver a un objeto")
        if any(resolved.get(key) in (None, "", []) for key in config.get("required_args") or []):
            return {"json": {"ready": False, "reason": "Completa los datos requeridos por la acción"}}
        if method == "flows_read_images":
            resolved["_flow_file_grants"] = config.get("_file_grants") or {}
        if method == "flows_render_pdf" and resolved.get("expected_pages") is not None and memory.get("report_template"):
            resolved["template_name"] = memory["report_template"]
        if method != "flows_read_images":
            _validate_action_paths(method, resolved, memory, self._store)
        if method == "canvas_export_cmyk_pdf":
            document = resolved.get("document") or {}
            layers = document.get("layers") or []
            if not layers:
                return {"json": {"ready": False, "reason": "La plantilla de Canvas no contiene elementos"}}
            required_images = 0
            fields: set[str] = set()
            for layer in layers:
                meta = layer.get("meta") or {}
                if layer.get("type") in ("image", "imageSlot") and "index" in meta:
                    required_images = max(required_images, int(meta["index"]) + 1)
                if layer.get("type") == "field" and meta.get("key"):
                    fields.add(str(meta["key"]))
                if layer.get("type") in ("field", "text"):
                    fields.update(re.findall(r"\{\{\s*([\w]+)\s*\}\}", str(layer.get("value") or "")))
            contexts = resolved.get("contexts") or [{}]
            if any(len(ctx.get("images") or []) < required_images or any(
                (ctx.get("data") or {}).get(key) in (None, "") for key in fields
            ) for ctx in contexts):
                return {"json": {"ready": False, "reason": "Faltan imágenes o campos requeridos por la plantilla de Canvas"}}
        if method == "flows_print_pdf":
            token = ctx.get("token")
            resolved["_cancelled"] = (lambda: token.cancelled) if token else None
        effect_key = None
        if memory.get("sources") and method in FLOW_ACTION_METHODS - ORCHESTRATABLE_METHODS - {"flows_read_images"}:
            identity = [node["id"], method, memory["sources"], memory.get("templates", []),
                        {key: value for key, value in resolved.items() if key != "_cancelled"}]
            effect_key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
            receipt = self._store.begin_action(
                memory["run"]["flow_id"],
                effect_key,
                allow_pending=bool(memory.get("acknowledge_uncertain")),
                context={"method": method, "node_id": node["id"], "run_id": memory["run"]["run_id"]},
            )
            if receipt is not None:
                result = receipt["output"]
                saved_path = result.get("saved_path")
                if not isinstance(saved_path, str) or Path(saved_path).is_file():
                    if isinstance(saved_path, str):
                        memory.setdefault("read_paths", set()).add(saved_path)
                        memory.setdefault("produced_paths", set()).add(saved_path)
                    return {"json": result}
                # El archivo producido fue borrado o movido: se re-ejecuta para regenerarlo.
        result = fn(dict(resolved))
        if method == "process_start":
            if not result.get("started"):
                raise ValueError(f"La conversión no pudo iniciarse: {result.get('reason')}")
            status_handler = self._handler_getter("process_status")
            if status_handler is None:
                raise ValueError("No se puede consultar la conversión iniciada")
            token = ctx.get("token")
            deadline = time.monotonic() + timeout_ms_for(method) / 1000
            while True:
                result = status_handler({"job_id": result.get("job_id") or result.get("id")})
                if not result.get("running"):
                    if result.get("err_count") or result.get("cancel_requested"):
                        raise ValueError("La conversión terminó con errores o fue cancelada")
                    break
                if token and token.wait(0.2):
                    cancel = self._handler_getter("process_cancel")
                    if cancel:
                        cancel({"job_id": result.get("id")})
                    break
                if time.monotonic() >= deadline:
                    cancel = self._handler_getter("process_cancel")
                    if cancel:
                        cancel({"job_id": result.get("id")})
                    raise ValueError("La conversión excedió el tiempo de espera del flujo")
                if token is None:
                    time.sleep(0.2)
        if effect_key is not None:
            self._store.complete_action(memory["run"]["flow_id"], effect_key, result)
        if method == "flows_read_images" and result.get("ready"):
            memory.setdefault("sources", []).append(result["fingerprint"])
            fingerprint = _source_fingerprint(memory["graph"], memory["sources"] + memory.get("templates", []))
            flow = self._store.get(memory["run"]["flow_id"])
            expected = _expected_output_paths(result, fingerprint)
            if _checkpoint_blocks(flow, fingerprint, expected):
                return {"json": {"ready": False, "reason": "Este lote ya fue generado"}}
            memory.setdefault("read_paths", set()).update(result["files"])
            memory.setdefault("write_roots", set()).add(result["output_folder"])
            # Los escalares del run viajan en la memoria compartida (node_memory es una copia).
            shared = ctx["memory"]
            with ctx["lock"]:
                shared["report_batch"] = result.get("report_batch", False)
                if result.get("report_batch"):
                    shared["report_template"] = result["template_name"]
            result["output_path"] = expected[0]
            result["stamped_output_path"] = str(Path(result["output_folder"]) / f"paneles-{fingerprint[:16]}-sellado.pdf")
        if method in FLOW_ACTION_METHODS - ORCHESTRATABLE_METHODS and isinstance(result.get("saved_path"), str):
            saved = Path(result["saved_path"])
            if saved.is_file() and not saved.is_symlink() and not any(p.is_symlink() for p in saved.parents):
                memory.setdefault("read_paths", set()).add(str(saved))
                memory.setdefault("produced_paths", set()).add(str(saved))
        return {"json": result}

    def _run_http_request(self, node: JsonObject, memory: JsonObject, token: _CancelEvent | None = None) -> JsonObject:
        config = node.get("config") or {}
        url = resolve(config.get("url"), memory)
        if not isinstance(url, str) or not url.strip():
            raise ValueError("http_request requiere config.url")
        url = url.strip()
        assert_allowed_url(url)

        method = str(resolve(config.get("method"), memory) or "GET").upper()
        if method not in _HTTP_METHODS:
            raise ValueError(f"Método HTTP no soportado: {method}")

        headers: dict[str, str] = {"User-Agent": "Antares/flujos", "Accept": "*/*"}
        extra = resolve(config.get("headers"), memory)
        if isinstance(extra, dict):
            for key, value in extra.items():
                headers[str(key)] = str(value)
        elif extra not in (None, ""):
            raise ValueError("headers de http_request debe ser un objeto JSON")

        host = (urllib.parse.urlparse(url).hostname or "").lower()
        auth_hosts: frozenset[str] = frozenset({host})
        connection_ref = config.get("connection_ref")
        if isinstance(connection_ref, str) and connection_ref.strip():
            if urllib.parse.urlparse(url).scheme.lower() != "https":
                raise ValueError("Las conexiones OAuth requieren HTTPS")
            conn_id = connection_ref.strip()
            allowed_hosts = frozenset(
                str(h).lower() for h in connections.get_provider(conn_id).get("token_hosts") or []
            )
            if host not in allowed_hosts:
                raise ValueError(f"La conexión {conn_id} solo firma peticiones a sus hosts autorizados")
            oauth_token = connections.fresh_access_token(conn_id)
            headers.setdefault("Authorization", f"Bearer {oauth_token}")
            auth_hosts = allowed_hosts

        body = resolve(config.get("body"), memory)
        data = None
        if body is not None and method not in ("GET", "HEAD"):
            if isinstance(body, (dict, list)):
                data = json.dumps(body, ensure_ascii=False).encode("utf-8")
                headers.setdefault("Content-Type", "application/json")
            else:
                data = str(body).encode("utf-8")

        raw_timeout = config.get("timeout_s")
        try:
            timeout = float(raw_timeout) if raw_timeout is not None else 20.0
        except (TypeError, ValueError):
            timeout = 20.0
        timeout = min(max(timeout, 1.0), 60.0)

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        opener = build_flow_opener(auth_hosts)

        def _open() -> tuple[int, bytes]:
            try:
                with opener.open(req, timeout=timeout) as res:
                    return int(res.status), res.read(_MAX_HTTP_BODY_BYTES + 1)
            except urllib.error.HTTPError as err:
                return int(err.code), err.read(_MAX_HTTP_BODY_BYTES + 1)

        try:
            status, raw_body = _await_or_cancel(_open, token)
        except urllib.error.URLError as err:
            raise ValueError(f"http_request no pudo contactar con el host: {err.reason}") from err

        text = raw_body[:_MAX_HTTP_BODY_BYTES].decode("utf-8", errors="replace")
        out: JsonObject = {
            "status": status,
            "ok": 200 <= status < 300,
            "truncated": len(raw_body) > _MAX_HTTP_BODY_BYTES,
            "text": text,
        }
        try:
            out["json"] = json.loads(text)
        except ValueError:
            out["json"] = text
        return {"json": out}

    @staticmethod
    def _run_condition(node: JsonObject, memory: JsonObject) -> JsonObject:
        config = node.get("config") or {}
        field = config.get("field")
        op = config.get("op") or "eq"
        expected = resolve(config.get("value"), memory)
        exists = True
        try:
            item = memory.get("item") or {}
            actual = resolve(field, memory) if field is not None else item.get("json")
        except ValueError:
            actual = None
            exists = False

        if op == "exists":
            result = exists
        else:
            if not exists:
                result = False
            elif op == "eq":
                result = actual == expected
            elif op == "neq":
                result = actual != expected
            elif op in ("gt", "gte", "lt", "lte"):
                result = _compare(actual, expected, op)
            elif op == "contains":
                result = _contains(actual, expected)
            else:
                raise ValueError(f"Operador de condición desconocido: {op}")

        port = "true" if result else "false"
        return {port: {"json": {"result": result, "field": actual}}}


def _retryable_http_output(node: JsonObject, node_outputs: JsonObject) -> bool:
    """True si un ``http_request`` devolvió un estado transitorio (5xx, 408, 429).

    Los errores HTTP llegan como ``ok: false`` sin excepción, así que el bucle
    de reintentos también mira el resultado para repetir esas respuestas.
    """
    if node.get("kind") != "http_request":
        return False
    main = node_outputs.get("main")
    out = main.get("json") if isinstance(main, dict) else None
    status = out.get("status") if isinstance(out, dict) else None
    return isinstance(status, int) and (status >= 500 or status in (408, 429))


def _retry_config(node: JsonObject) -> tuple[int, float]:
    if (node.get("config") or {}).get("method") in FLOW_ACTION_METHODS - ORCHESTRATABLE_METHODS - {"flows_read_images"}:
        return 1, 0.0
    retry = (node.get("config") or {}).get("retry")
    if not isinstance(retry, dict):
        return 1, 0.0
    attempts = retry.get("attempts", 1)
    delay = retry.get("delay_ms", 0)
    attempts_n = int(attempts) if isinstance(attempts, (int, float)) else 1
    delay_n = float(delay) if isinstance(delay, (int, float)) else 0.0
    return min(max(attempts_n, 1), 5), min(max(delay_n, 0.0), 60000.0)


def _source_fingerprint(graph: JsonObject, sources: list[str]) -> str:
    if any(n.get("config", {}).get("args", {}).get("report_template")
           for n in graph["nodes"] if isinstance(n.get("config", {}).get("args"), dict)):
        operations = [{"id": n["id"], "kind": n["kind"], "config": n["config"]}
                      for n in graph["nodes"] if n["kind"] != "trigger" and n["config"].get("method") != "flows_read_images"]
        destinations = [{"id": n["id"], "source_folder": n["config"]["args"].get("source_folder"),
                         "output_folder": n["config"]["args"].get("output_folder")}
                        for n in graph["nodes"] if n["config"].get("method") == "flows_read_images"]
        return hashlib.sha256(json.dumps([operations, destinations, graph["edges"], sorted(sources)], sort_keys=True).encode()).hexdigest()
    operations = [{"id": n["id"], "kind": n["kind"], "config": n["config"]} for n in graph["nodes"]]
    return hashlib.sha256(json.dumps([operations, graph["edges"], sorted(sources)], sort_keys=True).encode()).hexdigest()


def _expected_output_paths(source_result: JsonObject, fingerprint: str) -> list[str]:
    """Ruta canónica del PDF que el lote dejaría en ``output_folder``."""
    prefix = "reportes" if source_result.get("report_batch") else "paneles"
    return [str(Path(source_result["output_folder"]) / f"{prefix}-{fingerprint[:16]}.pdf")]


def _checkpoint_blocks(flow: JsonObject | None, fingerprint: str, expected: list[str]) -> bool:
    """True si el lote (fingerprint) ya fue generado y sus artefactos siguen en disco.

    ``source_artifacts`` guarda los ``saved_path`` que produjo el run que creó
    el checkpoint; si alguno desapareció (borrado o movido) el lote puede
    regenerarse. Los checkpoints anteriores al registro usan la ruta canónica
    ``expected`` como comprobación.
    """
    if flow is None:
        return False
    if fingerprint != flow.get("source_checkpoint") and fingerprint not in (flow.get("source_checkpoints") or []):
        return False
    recorded = (flow.get("source_artifacts") or {}).get(fingerprint)
    paths = recorded if recorded is not None else expected
    return all(Path(p).is_file() for p in paths)


def _validate_action_paths(method: str, args: JsonObject, memory: JsonObject, store: FlowStore | None = None) -> None:
    def values(value: Any, segments: tuple[str, ...]) -> list[Any]:
        if not segments:
            return [value]
        if segments[0] == "*":
            children = value.values() if isinstance(value, dict) else value if isinstance(value, list) else []
            return [item for child in children for item in values(child, segments[1:])]
        return values(value[segments[0]], segments[1:]) if isinstance(value, dict) and segments[0] in value else []

    grants: JsonObject = {"read": [], "write": []}
    for node in memory.get("graph", {}).get("nodes", []):
        node_grants = node.get("config", {}).get("_file_grants") or {}
        if node_grants and (store is None or not store.verify_paths(node_grants)):
            raise ValueError("Permiso de archivos inválido; vuelve a seleccionar las rutas")
        for mode in ("read", "write"):
            grants[mode].extend(node_grants.get(mode) or [])
    read_paths = set(memory.get("read_paths") or []) | set(grants.get("read") or [])
    write_roots = set(memory.get("write_roots") or []) | set(grants.get("write") or [])
    for schema in (*file_tokens_for(method), ("_resolved_file_token_path",)):
        for value in values(args, schema):
            if not value or (isinstance(value, str) and value.startswith(("data:", "canvas-asset:"))):
                continue
            if not isinstance(value, str) or value not in read_paths:
                raise ValueError("El archivo del paso no está autorizado; elígelo o usa la entrada de imágenes")
            p = Path(value)
            if p.is_symlink() or any(parent.is_symlink() for parent in p.parents):
                raise ValueError("Enlaces simbólicos no permitidos")
    keys = write_path_keys_for(method) | {"outputPath", "output_path", "output_dir", "outputDir", "output_folder", "destino", "_resolved_output_path"}
    if allows_raw_output_path(method):
        keys |= {"path"}
    for key in keys:
        value = args.get(key)
        if not value:
            continue
        p = Path(value)
        if not p.is_absolute() or p.is_symlink() or any(parent.is_symlink() for parent in p.parents):
            raise ValueError("Ruta de salida inválida")
        destination = p.resolve()
        if not any(destination == Path(root).resolve() or Path(root).resolve() in destination.parents for root in write_roots):
            raise ValueError("El destino del paso no está autorizado; elige una carpeta de salida")


def _compare(actual: Any, expected: Any, op: str) -> bool:
    try:
        left = float(actual)
        right = float(expected)
    except (TypeError, ValueError):
        return False
    if op == "gt":
        return left > right
    if op == "gte":
        return left >= right
    if op == "lt":
        return left < right
    return left <= right


def _contains(actual: Any, expected: Any) -> bool:
    if isinstance(actual, str):
        return str(expected) in actual
    if isinstance(actual, (list, tuple, set)):
        return expected in actual
    if isinstance(actual, dict):
        return expected in actual or expected in actual.values()
    return False
