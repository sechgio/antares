from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Any

from backend.core.agent import computer_files, computer_shell
from backend.core.agent.cancel import RunCancelled
from backend.core.integrations.types import JsonObject
from backend.utils.atomic_write import atomic_write_json

logger = logging.getLogger(__name__)

_MAX_JOBS_PER_SESSION = 2
_MAX_JOBS_GLOBAL = 4
_MAX_JOB_SECONDS = 1800
_MAX_COMMAND_CHARS = 8_000
_MAX_OUTPUT_CHARS = 4_000_000
_MAX_BUFFER_BYTES = 8_000_000
_WRITE_INTERVAL_S = 0.75
_JOB_ID = re.compile(r"[a-f0-9]{32}")
# Mismo preludio que shell_run: salida UTF-8 y sin progreso interactivo.
_PRELUDE = (
    "$ProgressPreference='SilentlyContinue';"
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8;"
)

TOOL_SPECS: list[JsonObject] = [
    {
        "name": "shell_job_start",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · shell_job_start (efecto: requiere aprobación del usuario): inicia un comando de PowerShell en "
            "segundo plano para builds o despliegues largos y devuelve job_id. El proceso sigue al terminar el turno, "
            "vive como máximo 30 minutos, no admite entrada interactiva y se detiene al cerrar Antares o al cancelar la "
            "conversación. Usa shell_job_status y shell_output para seguirlo, y wait_event kind=shell_job para esperar. "
            "Máximo 2 jobs por conversación; el comando requiere aprobación también en Acceso completo."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Comando o script de PowerShell"},
                "cwd": {"type": "string", "description": "Carpeta de trabajo autorizada; por defecto el espacio de trabajo"},
                "timeout_s": {"type": "integer", "minimum": 1, "maximum": _MAX_JOB_SECONDS},
            },
            "required": ["command"],
        },
    },
    {
        "name": "shell_job_status",
        "gated": False,
        "module": "computer",
        "description": (
            "Equipo · shell_job_status (solo lectura): consulta el estado de un job de shell_job_start de esta "
            "conversación, con su código de salida y output_id para shell_output. Devuelve interrupted si Antares se "
            "reinició mientras el job estaba en marcha."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string", "pattern": "^[a-f0-9]{32}$"}},
            "required": ["job_id"],
        },
    },
    {
        "name": "shell_job_cancel",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · shell_job_cancel (efecto: requiere aprobación del usuario): detiene el árbol de procesos de un "
            "job de shell_job_start de esta conversación. No afecta a otros jobs ni a procesos fuera de Antares."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string", "pattern": "^[a-f0-9]{32}$"}},
            "required": ["job_id"],
        },
    },
]


@dataclass
class _Job:
    id: str
    session_id: str
    root: Path
    process: subprocess.Popen[bytes]
    started_at: float
    deadline: float
    stdout: bytearray = field(default_factory=bytearray)
    stderr: bytearray = field(default_factory=bytearray)
    lock: threading.Lock = field(default_factory=threading.Lock)
    readers: list[threading.Thread] = field(default_factory=list)
    cancel_requested: bool = False
    timed_out: bool = False
    exit_code: int | None = None
    ended_at: float | None = None
    status: str = "running"
    written_at: float = 0.0
    dropped_stdout: int = 0
    dropped_stderr: int = 0


_JOBS: dict[str, _Job] = {}
_LOCK = threading.RLock()


def _job_id(value: object) -> str:
    if not isinstance(value, str) or not _JOB_ID.fullmatch(value):
        raise ValueError("Identificador de job inválido")
    return value


def _output_path(root: Path, job_id: str) -> Path:
    return root / f"shell-{job_id}.json"


def _meta_path(root: Path, job_id: str) -> Path:
    return root / f"shell-job-{job_id}.json"


def _append(job: _Job, stream: str, chunk: bytes) -> None:
    data = job.stdout if stream == "stdout" else job.stderr
    data.extend(chunk)
    if len(data) <= _MAX_BUFFER_BYTES:
        return
    keep = _MAX_BUFFER_BYTES // 2
    dropped = len(data) - _MAX_BUFFER_BYTES
    del data[keep:len(data) - keep]
    if stream == "stdout":
        job.dropped_stdout += dropped
    else:
        job.dropped_stderr += dropped


def _snapshot(job: _Job) -> JsonObject:
    with job.lock:
        stdout = bytes(job.stdout).decode("utf-8", errors="replace").replace("\r\n", "\n")
        stderr = bytes(job.stderr).decode("utf-8", errors="replace").replace("\r\n", "\n")
        dropped_stdout, dropped_stderr = job.dropped_stdout, job.dropped_stderr
    return {
        "stdout": computer_files.clip_text(stdout, _MAX_OUTPUT_CHARS),
        "stderr": computer_files.clip_text(stderr, _MAX_OUTPUT_CHARS),
        "dropped_stdout_bytes": dropped_stdout,
        "dropped_stderr_bytes": dropped_stderr,
    }


def _flush(job: _Job) -> None:
    payload = _snapshot(job)
    with job.lock:
        job.written_at = time.monotonic()
    atomic_write_json(_output_path(job.root, job.id), payload)


def _meta(job: _Job, status: str) -> JsonObject:
    return {
        "job_id": job.id,
        "session_id": job.session_id,
        "status": status,
        "exit_code": job.exit_code,
        "output_id": job.id,
        "started_at": job.started_at,
        "ended_at": job.ended_at,
        "timed_out": job.timed_out,
        "cancelled": status == "cancelled",
    }


def _write_meta(job: _Job, status: str) -> None:
    atomic_write_json(_meta_path(job.root, job.id), _meta(job, status))


def _pump(job: _Job, stream: str, handle: IO[bytes]) -> None:
    try:
        for chunk in iter(handle.readline, b""):
            with job.lock:
                _append(job, stream, chunk)
                due = time.monotonic() - job.written_at >= _WRITE_INTERVAL_S
            if due:
                try:
                    _flush(job)
                except OSError:
                    logger.warning("No se pudo escribir la salida del job %s", job.id, exc_info=True)
    finally:
        handle.close()


def _finish(job: _Job, status: str) -> None:
    job.status = status
    job.ended_at = time.time()
    try:
        _flush(job)
        _write_meta(job, status)
    except OSError:
        logger.warning("No se pudo persistir el job %s", job.id, exc_info=True)
    with _LOCK:
        _JOBS.pop(job.id, None)
    duration = (job.ended_at or time.time()) - job.started_at
    logger.info("Shell job %s terminó con estado %s en %.1f s", job.id, status, duration)


def _monitor(job: _Job) -> None:
    process = job.process
    while process.poll() is None:
        if job.cancel_requested:
            job.status = "cancelled"
            computer_shell.kill_tree(process)
            break
        if time.monotonic() > job.deadline:
            job.timed_out = True
            job.status = "timed_out"
            computer_shell.kill_tree(process)
            break
        time.sleep(0.1)
    process.wait()
    job.exit_code = process.returncode
    status = job.status
    if job.cancel_requested:
        status = "cancelled"
    elif job.timed_out:
        status = "timed_out"
    elif status == "running":
        status = "exited" if process.returncode == 0 else "failed"
    for reader in job.readers:
        reader.join(2)
    _finish(job, status)


def start(params: JsonObject, grants: dict[str, JsonObject], root: Path, session_id: str,
          token: Any = None) -> JsonObject:
    command = params.get("command")
    if not isinstance(command, str) or not command.strip():
        raise ValueError("Indica el comando")
    if len(command) > _MAX_COMMAND_CHARS:
        raise ValueError(f"El comando excede {_MAX_COMMAND_CHARS} caracteres")
    root.mkdir(parents=True, exist_ok=True)
    cwd = computer_files.resolve(params.get("cwd") or str(root), grants, root)
    if not cwd.is_dir():
        raise ValueError("La carpeta de trabajo no existe")
    raw_timeout = params.get("timeout_s")
    timeout = raw_timeout if isinstance(raw_timeout, int) and not isinstance(raw_timeout, bool) else _MAX_JOB_SECONDS
    timeout = max(1, min(_MAX_JOB_SECONDS, timeout))
    if token is not None and getattr(token, "cancelled", False):
        raise RunCancelled()
    with _LOCK:
        running = [job for job in _JOBS.values() if job.status == "running"]
        if sum(1 for job in running if job.session_id == session_id) >= _MAX_JOBS_PER_SESSION:
            raise ValueError(f"Ya hay {_MAX_JOBS_PER_SESSION} jobs en marcha en esta conversación")
        if len(running) >= _MAX_JOBS_GLOBAL:
            raise ValueError(f"Ya hay {_MAX_JOBS_GLOBAL} jobs en marcha en Antares")
        job_id = uuid.uuid4().hex
        env = {**os.environ, "ANTARES_AGENT_WORKSPACE": str(root)}
        process = subprocess.Popen(
            ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
             "-Command", _PRELUDE + command],
            cwd=str(cwd), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        job = _Job(id=job_id, session_id=session_id, root=root, process=process,
                   started_at=time.time(), deadline=time.monotonic() + timeout)
        _JOBS[job_id] = job
    if token is not None and getattr(token, "cancelled", False):
        with _LOCK:
            _JOBS.pop(job_id, None)
        computer_shell.kill_tree(process)
        process.wait()
        raise RunCancelled()
    try:
        _flush(job)
        _write_meta(job, "running")
    except OSError:
        logger.warning("No se pudo registrar el job %s", job.id, exc_info=True)
    assert process.stdout is not None and process.stderr is not None
    job.readers = [
        threading.Thread(target=_pump, args=(job, "stdout", process.stdout), daemon=True),
        threading.Thread(target=_pump, args=(job, "stderr", process.stderr), daemon=True),
    ]
    for reader in job.readers:
        reader.start()
    threading.Thread(target=_monitor, args=(job,), daemon=True, name=f"shell-job-{job_id}").start()
    return {"job_id": job_id, "output_id": job_id, "status": "running", "timeout_s": timeout,
            "started_at": job.started_at}


def _read_meta(root: Path, job_id: str, session_id: str) -> JsonObject:
    path = _meta_path(root, job_id)
    if not path.is_file():
        raise ValueError("El job no existe en esta conversación")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ValueError("El registro del job no es válido") from None
    if not isinstance(data, dict) or data.get("job_id") != job_id or data.get("session_id") != session_id:
        raise ValueError("El job no existe en esta conversación")
    return data


def _summary(job: _Job) -> JsonObject:
    ended = job.ended_at or time.time()
    return {
        "job_id": job.id,
        "status": job.status,
        "exit_code": job.exit_code,
        "output_id": job.id,
        "started_at": job.started_at,
        "ended_at": job.ended_at,
        "duration_s": round(ended - job.started_at, 2),
        "timed_out": job.timed_out,
        "cancelled": job.status == "cancelled",
    }


def status(params: JsonObject, root: Path, session_id: str) -> JsonObject:
    job_id = _job_id(params.get("job_id"))
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is not None and job.session_id == session_id:
            return _summary(job)
    data = _read_meta(root, job_id, session_id)
    if data.get("status") == "running":
        data["status"] = "interrupted"
        data["ended_at"] = time.time()
        atomic_write_json(_meta_path(root, job_id), data)
    return {
        "job_id": job_id,
        "status": data.get("status"),
        "exit_code": data.get("exit_code"),
        "output_id": data.get("output_id") or job_id,
        "started_at": data.get("started_at"),
        "ended_at": data.get("ended_at"),
        "duration_s": round((data.get("ended_at") or time.time()) - (data.get("started_at") or time.time()), 2),
        "timed_out": bool(data.get("timed_out")),
        "cancelled": bool(data.get("cancelled")),
    }


def cancel(params: JsonObject, root: Path, session_id: str) -> JsonObject:
    job_id = _job_id(params.get("job_id"))
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is not None and job.session_id == session_id:
            job.cancel_requested = True
            computer_shell.kill_tree(job.process)
            return {"job_id": job_id, "cancelled": True, "status": "cancelling"}
    data = _read_meta(root, job_id, session_id)
    if data.get("status") == "running":
        data["status"] = "interrupted"
        data["ended_at"] = time.time()
        atomic_write_json(_meta_path(root, job_id), data)
    return {"job_id": job_id, "cancelled": False, "status": data.get("status")}


def cancel_session(session_id: str) -> int:
    with _LOCK:
        jobs = [job for job in _JOBS.values() if job.session_id == session_id and job.status == "running"]
        for job in jobs:
            job.cancel_requested = True
            computer_shell.kill_tree(job.process)
    return len(jobs)


def kill_all() -> None:
    with _LOCK:
        jobs = list(_JOBS.values())
        for job in jobs:
            job.cancel_requested = True
            computer_shell.kill_tree(job.process)
    if jobs:
        logger.info("Se detuvieron %d jobs de shell al cerrar el backend", len(jobs))
