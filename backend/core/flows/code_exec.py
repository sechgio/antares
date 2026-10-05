"""Nodo ``code``: ejecuta el código Python del usuario en un subproceso aislado.

El proceso hijo corre con ``python -I`` (modo aislado: sin cwd ni variables
de entorno en sys.path), recibe el contexto por stdin como JSON
(``item``, ``items``, ``nodes``, ``run``, ``loop``) y el código debe dejar el resultado
en la variable ``result``. La cancelación mata el subproceso de inmediato.
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time

from backend.core.flows.types import JsonObject

_MAX_OUTPUT_CHARS = 8000

_HARNESS = """
import json, sys
payload = json.load(sys.stdin.buffer)
ns = {"item": payload.get("item"), "items": payload.get("items") or [],
      "nodes": payload.get("nodes") or {}, "run": payload.get("run") or {},
      "loop": payload.get("loop") or {}, "result": None}
try:
    exec(compile(payload.get("code") or "", "<nodo code>", "exec"), ns)
except BaseException as exc:
    sys.stdout.write(json.dumps(
        {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)[:900]},
        ensure_ascii=False))
else:
    try:
        sys.stdout.write(json.dumps({"ok": True, "result": ns.get("result")},
                                    ensure_ascii=False, default=str))
    except Exception:
        sys.stdout.write(json.dumps(
            {"ok": False, "error": "El resultado no es serializable a JSON"},
            ensure_ascii=False))
"""


class CodeCancelled(Exception):
    """El run se canceló y el subproceso del nodo code fue terminado."""


def run_python(code: str, payload: JsonObject, timeout_s: float, token: object | None) -> JsonObject:
    """Ejecuta ``code`` con ``payload`` de entrada; devuelve ``{"json": result}``."""
    command = (
        [sys.executable, "--flow-code-run"]
        if getattr(sys, "frozen", False)
        else [sys.executable, "-I", "-c", _HARNESS]
    )
    proc = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    out_box: dict[str, bytes] = {}
    err_box: dict[str, BaseException] = {}

    def _communicate() -> None:
        try:
            stdout, _ = proc.communicate(json.dumps(payload, default=str).encode("utf-8"))
            out_box["stdout"] = stdout
        except BaseException as exc:  # p. ej. BrokenPipeError si el hijo muere
            err_box["error"] = exc

    comm = threading.Thread(target=_communicate, daemon=True)
    comm.start()
    deadline = time.monotonic() + timeout_s
    while comm.is_alive():
        if token is not None and getattr(token, "cancelled", False):
            proc.kill()
            comm.join(2)
            raise CodeCancelled()
        if time.monotonic() >= deadline:
            proc.kill()
            comm.join(2)
            raise ValueError(f"El código excedió el tiempo máximo ({int(timeout_s)} s)")
        comm.join(0.1)
    if "error" in err_box:
        raise ValueError(f"No se pudo ejecutar el código: {err_box['error']}")
    raw = (out_box.get("stdout") or b"").decode("utf-8", errors="replace").strip()
    if not raw:
        raise ValueError(f"El código no produjo salida (exit {proc.returncode})")
    try:
        result = json.loads(raw.splitlines()[-1])
    except json.JSONDecodeError:
        raise ValueError(f"El código produjo salida no JSON: {raw[:200]}") from None
    if not result.get("ok"):
        raise ValueError(str(result.get("error") or "El código falló")[:500])
    value = result.get("result")
    if isinstance(value, str) and len(value) > _MAX_OUTPUT_CHARS:
        value = value[:_MAX_OUTPUT_CHARS]
    return {"json": value}


def run_code_child() -> int:
    """Ejecuta el harness cuando PyInstaller relanza el backend empaquetado."""
    exec(compile(_HARNESS, "<flow-code-runner>", "exec"), {})
    return 0
