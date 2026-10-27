from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from backend.core.agent import computer_files
from backend.core.agent.cancel import RunCancelled
from backend.core.integrations.types import JsonObject
from backend.utils.atomic_write import atomic_write_json

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
            "espacio de trabajo de la conversación o en una carpeta autorizada y devuelve su salida y código. "
            "El proceso puede acceder al equipo completo con los permisos del usuario, fuera de los grants de archivos. "
            "Cada comando requiere aprobación, también en Acceso completo. "
            "Devuelve output_id para recuperar con shell_output la salida completa si el resumen se recorta"
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
    {
        "name": "shell_output", "gated": False, "module": "computer",
        "description": "Equipo · shell_output (solo lectura): recupera la salida completa de un comando de esta conversación, "
                       "incluso tras reiniciar Antares. offset y next_offset son posiciones de caracteres, empezando en cero.",
        "inputSchema": {"type": "object", "properties": {
            "output_id": {"type": "string"}, "stream": {"type": "string", "enum": ["stdout", "stderr"]},
            "offset": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 2400},
        }, "required": ["output_id"]},
    },
]


def read_output(params: JsonObject, root: Path) -> JsonObject:
    output_id = params.get("output_id")
    stream = params.get("stream", "stdout")
    offset, limit = params.get("offset", 0), params.get("limit", 2400)
    if not isinstance(output_id, str) or not re.fullmatch(r"[a-f0-9]{32}", output_id) or stream not in {"stdout", "stderr"}:
        raise ValueError("Identificador o canal de salida inválido")
    if (not isinstance(offset, int) or isinstance(offset, bool) or offset < 0
            or not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 2400):
        raise ValueError("Indica una posición y un tamaño de página válidos")
    path = computer_files.resolve(f"shell-{output_id}.json", {}, root)
    if not path.is_file():
        raise ValueError("La salida no existe en esta conversación")
    content = json.loads(path.read_text(encoding="utf-8"))[stream]
    page = computer_files.fit({"output_id": output_id, "stream": stream, "offset": offset,
                               "total_chars": len(content), "content": content[offset:offset + limit]}, 5400)
    following = offset + len(page["content"])
    page["next_offset"] = following if following < len(content) else None
    return page


def _clip(text: str) -> str:
    if len(text) <= _MAX_OUTPUT_CHARS:
        return text
    half = _MAX_OUTPUT_CHARS // 2
    return f"{text[:half]}\n… [{len(text) - _MAX_OUTPUT_CHARS} caracteres omitidos] …\n{text[-half:]}"


def kill_tree(process: subprocess.Popen[bytes]) -> None:
    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False,
                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def run(params: JsonObject, grants: dict[str, JsonObject], root: Path, token: Any = None,
        *, workspace: Path | None = None) -> JsonObject:
    command = params.get("command")
    if not isinstance(command, str) or not command.strip():
        raise ValueError("Indica el comando")
    if len(command) > _MAX_COMMAND_CHARS:
        raise ValueError(f"El comando excede {_MAX_COMMAND_CHARS} caracteres")
    # root guarda las salidas; workspace es la carpeta donde trabaja el comando.
    workspace = workspace or root
    cwd = computer_files.resolve(params.get("cwd") or str(workspace), grants, workspace)
    if not cwd.is_dir():
        raise ValueError("La carpeta de trabajo no existe")
    raw_timeout = params.get("timeout_s")
    timeout = raw_timeout if isinstance(raw_timeout, int) and not isinstance(raw_timeout, bool) else _DEFAULT_TIMEOUT_S
    timeout = max(1, min(_MAX_TIMEOUT_S, timeout))
    env = {**os.environ, "ANTARES_AGENT_WORKSPACE": str(workspace)}
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
    cancelled = False
    while process.poll() is None:
        if token is not None and getattr(token, "cancelled", False):
            kill_tree(process)
            cancelled = True
            break
        if time.monotonic() - started > timeout:
            timed_out = True
            kill_tree(process)
            break
        time.sleep(0.1)
    process.wait()
    for reader in readers:
        reader.join(2)

    output = {name: b"".join(chunks[name]).decode("utf-8", errors="replace").replace("\r\n", "\n")
              for name in ("stdout", "stderr")}
    output_id = uuid.uuid4().hex
    atomic_write_json(root / f"shell-{output_id}.json", output)
    if cancelled:
        raise RunCancelled()

    result: JsonObject = {"exit_code": process.returncode, "cwd": str(cwd), "stdout": _clip(output["stdout"]),
                          "stderr": _clip(output["stderr"]), "output_id": output_id,
                          "duration_s": round(time.monotonic() - started, 2)}
    if timed_out:
        result["error"] = f"El comando superó {timeout} s y se detuvo"
    elif process.returncode != 0:
        result["error"] = f"El comando terminó con código {process.returncode}"
    return result
