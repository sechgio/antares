from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from backend.core.agent import computer_files
from backend.core.agent.cancel import RunCancelled
from backend.core.integrations.types import JsonObject

_DEFAULT_TIMEOUT_S = 120
_MAX_TIMEOUT_S = 600
_MAX_OUTPUT_CHARS = 2_400
_MAX_COMMAND_CHARS = 8_000
_PRELUDE = (
    "$ProgressPreference='SilentlyContinue';"
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8;"
)

TOOL_SPECS: list[JsonObject] = [
    {
        "name": "shell_run",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · shell_run (efecto: requiere aprobación del usuario): ejecuta un comando de PowerShell en el "
            "espacio de trabajo de la conversación o en una carpeta autorizada y devuelve su salida y código"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Comando o script de PowerShell"},
                "cwd": {"type": "string", "description": "Carpeta de trabajo autorizada; por defecto el espacio de trabajo"},
                "timeout_s": {"type": "integer", "minimum": 1, "maximum": _MAX_TIMEOUT_S},
            },
            "required": ["command"],
        },
    },
]


def _clip(text: str) -> str:
    if len(text) <= _MAX_OUTPUT_CHARS:
        return text
    half = _MAX_OUTPUT_CHARS // 2
    return f"{text[:half]}\n… [{len(text) - _MAX_OUTPUT_CHARS} caracteres omitidos] …\n{text[-half:]}"


def _kill_tree(process: subprocess.Popen[bytes]) -> None:
    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False,
                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def run(params: JsonObject, grants: dict[str, JsonObject], root: Path, token: Any = None) -> JsonObject:
    command = params.get("command")
    if not isinstance(command, str) or not command.strip():
        raise ValueError("Indica el comando")
    if len(command) > _MAX_COMMAND_CHARS:
        raise ValueError(f"El comando excede {_MAX_COMMAND_CHARS} caracteres")
    cwd = computer_files.resolve(params.get("cwd") or str(root), grants, root)
    if not cwd.is_dir():
        raise ValueError("La carpeta de trabajo no existe")
    raw_timeout = params.get("timeout_s")
    timeout = raw_timeout if isinstance(raw_timeout, int) and not isinstance(raw_timeout, bool) else _DEFAULT_TIMEOUT_S
    timeout = max(1, min(_MAX_TIMEOUT_S, timeout))
    env = {**os.environ, "ANTARES_AGENT_WORKSPACE": str(root)}
    started = time.monotonic()
    process = subprocess.Popen(
        ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
         "-Command", _PRELUDE + command],
        cwd=str(cwd), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    chunks: dict[str, list[bytes]] = {"stdout": [], "stderr": []}
    report = getattr(token, "report", None)

    def pump(name: str, stream: Any) -> None:
        for line in iter(stream.readline, b""):
            chunks[name].append(line)
            if callable(report):
                report(line.decode("utf-8", errors="replace").replace("\r\n", "\n"))

    readers = [threading.Thread(target=pump, args=(name, getattr(process, name)), daemon=True)
               for name in ("stdout", "stderr")]
    for reader in readers:
        reader.start()
    timed_out = False
    while process.poll() is None:
        if token is not None and getattr(token, "cancelled", False):
            _kill_tree(process)
            raise RunCancelled()
        if time.monotonic() - started > timeout:
            timed_out = True
            _kill_tree(process)
            break
        time.sleep(0.1)
    process.wait()
    for reader in readers:
        reader.join(2)

    def text(name: str) -> str:
        return _clip(b"".join(chunks[name]).decode("utf-8", errors="replace").replace("\r\n", "\n"))

    result: JsonObject = {"exit_code": process.returncode, "cwd": str(cwd), "stdout": text("stdout"),
                          "stderr": text("stderr"), "duration_s": round(time.monotonic() - started, 2)}
    if timed_out:
        result["error"] = f"El comando superó {timeout} s y se detuvo"
    return result
