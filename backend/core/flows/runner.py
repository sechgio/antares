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

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

from backend.core.flows import agent_chat, connections
from backend.core.flows.expr import interpolate_text, resolve
from backend.core.flows.schema import IMPLEMENTED_NODE_KINDS, normalize_graph, validate_graph
from backend.core.flows.store import FlowStore, _utc_now
from backend.core.flows.types import JsonObject
from backend.core.ipc_catalog import ORCHESTRATABLE_METHODS

logger = logging.getLogger(__name__)

_MAX_STEP_OUTPUT_CHARS = 8000
_MAX_HTTP_BODY_BYTES = 512 * 1024
_HTTP_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"})


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

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()


_active_runs: dict[str, _CancelEvent] = {}
_active_lock = threading.Lock()


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

    def start(self, flow_id: str, trigger_payload: JsonObject | None = None) -> JsonObject:
        run = self._store.create_run(flow_id, trigger_payload)
        if run is None:
            raise ValueError(f"Flujo no encontrado: {flow_id}")
        token = _register(run["id"])
        thread = threading.Thread(
            target=self._execute_safe,
            args=(run["id"], token),
            name=f"flow-run-{run['id']}",
            daemon=True,
        )
        thread.start()
        return run

    def _execute_safe(self, run_id: str, token: _CancelEvent) -> None:
        try:
            self._execute(run_id, token)
        except Exception:
            logger.exception("Fallo no controlado en run de flujo %s", run_id)
            self._store.update_run(
                run_id,
                status="error",
                error="Error interno del ejecutor de flujos",
                finished_at=_utc_now(),
            )
        finally:
            _unregister(run_id)

    def _execute(self, run_id: str, token: _CancelEvent) -> None:
        run = self._store.get_run(run_id)
        if run is None:
            return
        flow = self._store.get(run["flow_id"])
        if flow is None:
            self._store.update_run(run_id, status="error", error="El flujo ya no existe", finished_at=_utc_now())
            return
        try:
            graph = normalize_graph(run.get("graph") or flow["graph"])
            validate_graph(graph)
        except ValueError as exc:
            self._store.update_run(run_id, status="error", error=str(exc), finished_at=_utc_now())
            return

        self._store.update_run(run_id, status="running", started_at=_utc_now())

        nodes = {n["id"]: n for n in graph["nodes"]}
        inbound: dict[str, list[JsonObject]] = {n["id"]: [] for n in graph["nodes"]}
        for edge in graph["edges"]:
            inbound[edge["to_node"]].append(edge)
        order = self._topological_order(graph)

        outputs: dict[str, JsonObject] = {}
        memory: JsonObject = {
            "run": {
                "run_id": run_id,
                "flow_id": run["flow_id"],
                "trigger": run.get("trigger_payload") or {},
            },
            "nodes": {},
            "item": None,
            "items": [],
        }
        steps: list[JsonObject] = []
        any_error = False

        for node_id in order:
            node = nodes[node_id]
            if token.cancelled:
                steps.append(self._step(node, "cancelled"))
                break

            live_items: list[Any] = []
            if node["kind"] == "trigger":
                live_items = [run.get("trigger_payload") or {}]
            else:
                for edge in inbound[node_id]:
                    src_outputs = outputs.get(edge["from_node"]) or {}
                    if edge["from_port"] in src_outputs:
                        live_items.append(src_outputs[edge["from_port"]].get("json"))

            if not live_items:
                steps.append(self._step(node, "skipped"))
                continue

            memory["item"] = {"json": live_items[0]}
            memory["items"] = [{"json": i} for i in live_items]

            started = _utc_ms()
            step = self._step(node, "running", started_at=_utc_now())
            attempts, delay_ms = _retry_config(node)
            tried = 0
            try:
                while True:
                    tried += 1
                    try:
                        node_outputs = self._execute_node(node, memory)
                        break
                    except Exception:
                        if tried >= attempts or token.cancelled:
                            raise
                        if delay_ms > 0:
                            time.sleep(delay_ms / 1000.0)
                if tried > 1:
                    step["attempts"] = tried
            except Exception as exc:
                logger.info("Nodo %s del run %s falló: %s", node_id, run_id, exc)
                any_error = True
                step["status"] = "error"
                step["error"] = str(exc)[:500]
                if tried > 1:
                    step["attempts"] = tried
                step["finished_at"] = _utc_now()
                step["duration_ms"] = round(_utc_ms() - started)
                outputs[node_id] = {}
                steps.append(step)
                continue

            step["status"] = "success"
            step["finished_at"] = _utc_now()
            step["duration_ms"] = round(_utc_ms() - started)
            first_port = next(iter(node_outputs), "main")
            step["output"] = _summarize(node_outputs[first_port].get("json"))
            outputs[node_id] = node_outputs
            memory["nodes"][node_id] = node_outputs[first_port]
            steps.append(step)

        if token.cancelled:
            self._store.update_run(
                run_id,
                status="cancelled",
                steps=steps,
                finished_at=_utc_now(),
            )
            return
        status = "error" if any_error else "success"
        self._store.update_run(
            run_id,
            status=status,
            steps=steps,
            finished_at=_utc_now(),
            error="Uno o más nodos fallaron" if any_error else None,
        )

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

    def _execute_node(self, node: JsonObject, memory: JsonObject) -> JsonObject:
        kind = node["kind"]
        if kind not in IMPLEMENTED_NODE_KINDS:
            raise ValueError(f"Tipo de nodo aún no implementado: {kind}")
        if kind == "trigger":
            return {"main": {"json": memory["run"]["trigger"]}}
        if kind == "tool_call":
            return {"main": self._run_tool_call(node, memory)}
        if kind == "condition":
            return self._run_condition(node, memory)
        if kind == "transform":
            config = node.get("config") or {}
            output = resolve(config.get("output"), memory)
            return {"main": {"json": output}}
        if kind == "http_request":
            return {"main": self._run_http_request(node, memory)}
        if kind == "agent":
            return {"main": self._run_agent(node, memory)}
        if kind == "switch":
            return self._run_switch(node, memory)
        raise ValueError(f"Tipo de nodo desconocido: {kind}")

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
        spec = agent_chat.ai_providers.get_provider(provider)
        default_model = (spec.get("chat") or {}).get("default_model", "")
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

    def _run_tool_call(self, node: JsonObject, memory: JsonObject) -> JsonObject:
        config = node.get("config") or {}
        method = config.get("method")
        if method not in ORCHESTRATABLE_METHODS:
            raise ValueError(f"Método no orquestable: {method}")
        fn = self._handler_getter(method)
        if fn is None:
            raise ValueError(f"Handler no disponible: {method}")
        args = config.get("args")
        resolved = resolve(args, memory) if isinstance(args, dict) else {}
        result = fn(dict(resolved))
        return {"json": result}

    def _run_http_request(self, node: JsonObject, memory: JsonObject) -> JsonObject:
        config = node.get("config") or {}
        url = resolve(config.get("url"), memory)
        if not isinstance(url, str) or not url.strip():
            raise ValueError("http_request requiere config.url")
        url = url.strip()
        scheme = urllib.parse.urlparse(url).scheme.lower()
        if scheme not in ("http", "https"):
            raise ValueError(f"URL no permitida en http_request (solo http/https): {url[:80]}")

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

        connection_ref = config.get("connection_ref")
        if isinstance(connection_ref, str) and connection_ref.strip():
            conn_id = connection_ref.strip()
            allowed_hosts = connections.get_provider(conn_id).get("token_hosts") or []
            host = (urllib.parse.urlparse(url).hostname or "").lower()
            if allowed_hosts and host not in {str(h).lower() for h in allowed_hosts}:
                raise ValueError(f"La conexión {conn_id} solo firma peticiones a sus hosts autorizados")
            token = connections.fresh_access_token(conn_id)
            headers.setdefault("Authorization", f"Bearer {token}")

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
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                status = int(res.status)
                raw_body = res.read(_MAX_HTTP_BODY_BYTES + 1)
        except urllib.error.HTTPError as err:
            status = int(err.code)
            raw_body = err.read(_MAX_HTTP_BODY_BYTES + 1)
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


def _retry_config(node: JsonObject) -> tuple[int, float]:
    retry = (node.get("config") or {}).get("retry")
    if not isinstance(retry, dict):
        return 1, 0.0
    attempts = retry.get("attempts", 1)
    delay = retry.get("delay_ms", 0)
    attempts_n = int(attempts) if isinstance(attempts, (int, float)) else 1
    delay_n = float(delay) if isinstance(delay, (int, float)) else 0.0
    return min(max(attempts_n, 1), 5), min(max(delay_n, 0.0), 60000.0)


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
