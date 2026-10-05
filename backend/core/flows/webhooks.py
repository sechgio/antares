"""Disparadores ``webhook``: listener HTTP local para iniciar flujos.

Escucha solo en ``127.0.0.1`` (nunca expone la red). Cada flujo con trigger
``webhook`` atiende ``<método> /hooks/<flow_id>[/<path>]``; el ``path`` acota
las llamadas y el ``secret`` (obligatorio) las autentica por cabecera
``X-Antares-Flow-Key`` o parámetro ``?key=``.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, cast

from backend.core.flows.types import JsonObject

logger = logging.getLogger(__name__)

_MAX_BODY_BYTES = 512 * 1024
_DEFAULT_PORT = 47823
_PORT_ATTEMPTS = 10


def _find_flow(store: Any, flow_id: str, suffix: str) -> JsonObject | None:
    flow = store.get(flow_id)
    if flow is None or not isinstance(flow, dict) or not flow.get("enabled"):
        return None
    trigger = next((n for n in flow["graph"]["nodes"] if n.get("kind") == "trigger"), None)
    config = (trigger or {}).get("config") or {}
    if config.get("trigger_kind") != "webhook":
        return None
    expected = str(config.get("path") or "").strip("/")
    if expected and expected != suffix:
        return None
    return cast(JsonObject, flow)


def _check_secret(flow: JsonObject, headers: Any, query: dict[str, list[str]]) -> bool:
    trigger = next((n for n in flow["graph"]["nodes"] if n.get("kind") == "trigger"), None)
    secret = str(((trigger or {}).get("config") or {}).get("secret") or "")
    if not secret:
        return False
    given = headers.get("X-Antares-Flow-Key") or (query.get("key") or [""])[0]
    return hmac.compare_digest(str(given), secret)


def _make_handler(store: Any, runner: Any) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "AntaresFlows/1.0"

        def _dispatch(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            parts = [p for p in parsed.path.split("/") if p]
            if len(parts) < 2 or parts[0] != "hooks":
                self._reply(404, {"error": "Ruta desconocida"})
                return
            flow_id, suffix = parts[1], "/".join(parts[2:])
            query = urllib.parse.parse_qs(parsed.query)
            flow = _find_flow(store, flow_id, suffix)
            if flow is None:
                self._reply(404, {"error": "Flujo no encontrado o sin trigger webhook"})
                return
            if not _check_secret(flow, self.headers, query):
                self._reply(403, {"error": "Clave de webhook incorrecta"})
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length > _MAX_BODY_BYTES:
                self._reply(413, {"error": "Cuerpo demasiado grande"})
                return
            raw = self.rfile.read(length) if length else b""
            body: Any = raw.decode("utf-8", errors="replace")
            if "application/json" in (self.headers.get("Content-Type") or ""):
                try:
                    body = json.loads(body)
                except json.JSONDecodeError:
                    self._reply(400, {"error": "JSON inválido"})
                    return
            payload = {
                "source": "webhook",
                "method": self.command,
                "path": parsed.path,
                # La clave autentica pero no se guarda en el historial del run.
                "query": {k: v[0] if len(v) == 1 else v for k, v in query.items() if k != "key"},
                "body": body,
            }
            try:
                run = runner.start(flow["id"], payload)
            except Exception as exc:
                self._reply(409, {"error": str(exc)[:200]})
                return
            self._reply(202, {"run_id": run["id"], "queued": True})

        do_GET = _dispatch
        do_POST = _dispatch
        do_PUT = _dispatch
        do_DELETE = _dispatch
        do_PATCH = _dispatch

        def _reply(self, status: int, data: JsonObject) -> None:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args: Any) -> None:
            logger.debug("webhook: " + fmt, *args)

    return Handler


class WebhookServer:
    def __init__(self, store_getter: Any, runner_getter: Any) -> None:
        self._store_getter = store_getter
        self._runner_getter = runner_getter
        self._server: ThreadingHTTPServer | None = None
        self._lock = threading.Lock()
        self.port: int | None = None

    def start(self) -> None:
        with self._lock:
            if self._server is not None:
                return
            handler = _make_handler(self._store_getter(), self._runner_getter())
            base = int(os.environ.get("ANTARES_FLOWS_WEBHOOK_PORT") or _DEFAULT_PORT)
            server = None
            for offset in range(_PORT_ATTEMPTS):
                try:
                    server = ThreadingHTTPServer(("127.0.0.1", base + offset), handler)
                    break
                except OSError:
                    continue
            if server is None:
                logger.warning("No se encontró puerto libre para webhooks de flujos")
                return
            self._server = server
            self.port = int(server.server_address[1])
            threading.Thread(target=server.serve_forever, name="flows-webhooks", daemon=True).start()
            logger.info("Webhooks de flujos escuchando en http://127.0.0.1:%s/hooks/<flow_id>", self.port)

    def info(self) -> JsonObject:
        return {
            "running": self._server is not None,
            "port": self.port,
            "url_template": f"http://127.0.0.1:{self.port}/hooks/<flow_id>" if self.port else None,
        }


_singleton: WebhookServer | None = None
_singleton_lock = threading.Lock()


def get_webhook_server(store_getter: Any, runner_getter: Any) -> WebhookServer:
    global _singleton
    with _singleton_lock:
        if _singleton is None:
            _singleton = WebhookServer(store_getter, runner_getter)
        return _singleton
