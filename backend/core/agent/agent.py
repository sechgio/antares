from __future__ import annotations

import hashlib
import json
import logging
import ntpath
import os
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import TimeoutError as FutureTimeoutError
from datetime import date
from pathlib import Path

from backend.core.agent import agent_tools, drafts, resource_grants, subagent
from backend.core.agent import undo as undo_journal
from backend.core.agent.agent_chat import replay_safe, result_failed, scrub_secrets, tool_specs
from backend.core.agent.cancel import RunCancelled, _CancelEvent, await_or_cancel
from backend.core.integrations import mcp_servers
from backend.core.integrations.types import JsonObject
from backend.core.ipc_catalog import (
    allows_raw_output_path,
    file_tokens_for,
    lane_for,
    timeout_ms_for,
    write_path_keys_for,
)
from backend.core.scheduler import get_scheduler
from backend.utils.atomic_write import atomic_write_json
from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)


def _schema_values(value: object, segments: tuple[str, ...]) -> list[object]:
    if not segments:
        return [value]
    if segments[0] == "*":
        children = value.values() if isinstance(value, dict) else value if isinstance(value, list) else []
        return [item for child in children for item in _schema_values(child, segments[1:])]
    return _schema_values(value[segments[0]], segments[1:]) if isinstance(value, dict) and segments[0] in value else []


def read_resources(
    method: str, args: JsonObject, grants: dict[str, JsonObject], drafts_root: Path | None = None,
) -> list[JsonObject]:
    revisions: list[JsonObject] = []
    for schema in file_tokens_for(method):
        for value in _schema_values(args, schema):
            if not value or (isinstance(value, str) and value.startswith(("data:", "canvas-asset:"))):
                continue
            if not isinstance(value, str):
                raise ValueError("El archivo del paso no está autorizado; elígelo o usa la entrada de imágenes")
            draft = drafts.inside(drafts_root, value) if drafts_root is not None else None
            if draft is not None and draft.is_file():
                stat = draft.stat()
                revisions.append({"path": str(draft), "size": stat.st_size, "mtime_ns": stat.st_mtime_ns, "value": value})
                continue
            revisions.append({**resource_grants.check(value, grants), "value": value})
    return sorted(revisions, key=lambda r: str(r["path"]))


def _write_keys(method: str) -> frozenset[str]:
    keys = write_path_keys_for(method) | {"outputPath", "output_path", "output_dir", "outputDir", "output_folder", "destino"}
    return keys | {"path"} if allows_raw_output_path(method) else keys


def _validate_action_paths(
    method: str, args: JsonObject, grants: dict[str, JsonObject] | None = None, drafts_root: Path | None = None,
) -> None:
    read_resources(method, args, grants or {}, drafts_root)
    for key in ("_resolved_file_token_path", "_resolved_output_path"):
        if args.get(key):
            raise ValueError("El agente no puede concederse permisos de archivos")
    for key in _write_keys(method):
        value = args.get(key)
        if not value:
            continue
        if not isinstance(value, str) or drafts_root is None or drafts.inside(drafts_root, value) is None:
            raise ValueError("El destino del paso no está autorizado; el agente escribe en sus borradores")

_MAX_TOOL_RESULT_CHARS = 6_000
_MAX_RECEIPT_CHARS = 2 * 1024 * 1024
_MAX_SESSIONS = 50
_APPROVAL_TTL_MS = 24 * 3600 * 1000
_INTERRUPTED_RESULT = json.dumps(
    {"error": "Acción interrumpida: el resultado puede ser incierto. Compruébalo antes de repetirla."},
    ensure_ascii=False,
)


def _now_ms() -> float:
    return time.time() * 1000


def fingerprint(method: str, params: object) -> str:
    canonical = json.dumps({"method": method, "params": params}, sort_keys=True, ensure_ascii=False,
                           separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def dispatch_key(session_id: str, call_id: str) -> str:
    """El ``call_id`` del proveedor solo es único dentro de su conversación."""
    return f"{session_id}:{call_id}"


def summarize_result(full: str) -> str:
    if len(full) <= _MAX_TOOL_RESULT_CHARS:
        return full
    preview = full[: _MAX_TOOL_RESULT_CHARS - 200]
    return json.dumps({"truncated": True, "total_chars": len(full), "preview": preview,
                       **({"isError": True} if result_failed(full) else {})}, ensure_ascii=False)


class AgentStore:
    def __init__(self, base_dir: Path | None = None) -> None:
        base = base_dir or user_data_path("ai-agent")
        base.mkdir(parents=True, exist_ok=True)
        self.base_dir = base
        self._sessions_path = base / "sessions.json"
        self._approvals_path = base / "approvals.json"
        self._grants_path = base / "grants.json"
        self._drafts_root = base / "drafts"
        self._undo = undo_journal.UndoJournal(base)
        self._dispatches_path = base / "dispatches.json"
        self._messages_dir = base / "messages"
        self._messages_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._sessions: dict[str, JsonObject] = self._read(self._sessions_path)
        self._approvals: dict[str, JsonObject] = self._read(self._approvals_path)
        self._grants: dict[str, JsonObject] = self._read(self._grants_path)
        self._artifacts_path = base / "artifacts.json"
        self._artifacts: dict[str, JsonObject] = self._read(self._artifacts_path)
        self._questions_path = base / "questions.json"
        self._questions: dict[str, JsonObject] = self._read(self._questions_path)
        for question in self._questions.values():
            if question.get("status") == "pending":
                question["status"] = "interrupted"
        atomic_write_json(self._questions_path, self._questions)
        loaded = self._read(self._dispatches_path)
        self._dispatches: dict[str, JsonObject] = {
            (key if ":" in key or not isinstance(rec, dict) or not rec.get("session_id")
             else dispatch_key(str(rec["session_id"]), str(rec.get("call_id") or key))): rec
            for key, rec in loaded.items()
        }
        dirty = self._dispatches.keys() != loaded.keys()
        for record in self._dispatches.values():
            if record.get("status") == "running":
                record["status"] = "uncertain"
                record["result"] = _INTERRUPTED_RESULT
                record["summary"] = _INTERRUPTED_RESULT
                if record.get("method") == "artifact_print":
                    from backend.core.printing import printer_job_status

                    print_approval = self._approvals.get(str(record.get("approval_id"))) or {}
                    printer = record.get("printer_name") or (print_approval.get("params") or {}).get("printer_name")
                    try:
                        receipt = printer_job_status(str(printer or ""), f"Antares-{record['op_id']}")
                        record["status"] = "submitted" if receipt.get("submitted") else "uncertain"
                        record["result"] = json.dumps({**receipt, "recovered": True, "interrupted": not receipt.get("submitted")}, ensure_ascii=False)
                        record["summary"] = record["result"]
                    except Exception:
                        logger.warning("No se pudo verificar el trabajo de impresión %s", record.get("op_id"), exc_info=True)
                dirty = True
        self._undo.prune()
        for record in self._dispatches.values():
            undo = record.get("undo")
            if not isinstance(undo, dict) or not undo.get("available"):
                continue
            directory = undo.get("dir")
            if not isinstance(directory, str) or not Path(directory).is_dir():
                undo["available"] = False
                undo["reason"] = "La copia de seguridad expiró"
                dirty = True
        for record in self._dispatches.values():
            if record.get("status") != "uncertain":
                continue
            undo = record.get("undo")
            if not isinstance(undo, dict) or not undo.get("available"):
                continue
            if self._undo.matches_after(undo):
                record["status"] = "succeeded"
                recovered_result = json.dumps(
                    {"recovered": True, "detail": "La escritura terminó antes de que la aplicación se cerrara"},
                    ensure_ascii=False,
                )
                record["result"] = recovered_result
                record["summary"] = recovered_result
                record.setdefault("finished_at", _now_ms())
                dirty = True
            else:
                undo["available"] = False
                undo["reason"] = (
                    "La escritura quedó sin confirmar; no hay un resultado verificado que deshacer"
                    if not undo.get("after_sha256")
                    else "El archivo no coincide con el resultado esperado; no se puede deshacer con seguridad"
                )
                dirty = True
        if dirty:
            self._write_dispatches()
        consumed = False
        for record in self._dispatches.values():
            approval = self._approvals.get(str(record.get("approval_id") or ""))
            if approval is not None and not approval.get("consumed_by"):
                approval["consumed_by"] = record.get("op_id") or record.get("call_id")
                consumed = True
        if consumed:
            self._write_approvals()

    @staticmethod
    def _read(path: Path) -> dict[str, JsonObject]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return dict(data) if isinstance(data, dict) else {}

    def _write_sessions(self) -> None:
        atomic_write_json(self._sessions_path, self._sessions)

    def _write_approvals(self) -> None:
        atomic_write_json(self._approvals_path, self._approvals)

    def _write_grants(self) -> None:
        atomic_write_json(self._grants_path, self._grants)

    def _write_dispatches(self) -> None:
        atomic_write_json(self._dispatches_path, self._dispatches)

    def _messages_path(self, session_id: str) -> Path:
        safe = "".join(ch for ch in session_id if ch.isalnum() or ch in "-_")[:64]
        return self._messages_dir / f"{safe}.json"

    def _read_messages(self, session_id: str) -> list[JsonObject]:
        try:
            data = json.loads(self._messages_path(session_id).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        return list(data) if isinstance(data, list) else []

    def _write_messages(self, session_id: str, messages: list[JsonObject]) -> None:
        atomic_write_json(self._messages_path(session_id), messages)

    def create_session(self, provider: str, model: str, title: str) -> JsonObject:
        session: JsonObject = {
            "id": uuid.uuid4().hex[:12],
            "title": title or "Conversación",
            "provider": provider,
            "model": model,
            "created_at": _now_ms(),
            "updated_at": _now_ms(),
            "last_error": None,
        }
        with self._lock:
            self._sessions[session["id"]] = session
            if len(self._sessions) > _MAX_SESSIONS:
                oldest = sorted(self._sessions.values(), key=lambda s: s.get("created_at") or 0)
                for old in oldest[: len(self._sessions) - _MAX_SESSIONS]:
                    self._sessions.pop(str(old["id"]), None)
            self._write_sessions()
        return session

    def get_session(self, session_id: str) -> JsonObject | None:
        with self._lock:
            session = self._sessions.get(session_id)
            return dict(session) if isinstance(session, dict) else None

    def list_sessions(self) -> list[JsonObject]:
        with self._lock:
            return sorted(
                (dict(s) for s in self._sessions.values()),
                key=lambda s: s.get("updated_at") or 0,
                reverse=True,
            )

    def touch_session(self, session_id: str, error: str | None = None) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            session["updated_at"] = _now_ms()
            session["last_error"] = error
            self._write_sessions()

    def delete_session(self, session_id: str) -> bool:
        with self._lock:
            removed = self._sessions.pop(session_id, None) is not None
            if removed:
                self._write_sessions()
            self._approvals = {k: a for k, a in self._approvals.items() if a.get("session_id") != session_id}
            self._write_approvals()
            self.revoke_grants(session_id)
            if self._artifacts.pop(session_id, None) is not None:
                atomic_write_json(self._artifacts_path, self._artifacts)
            self._questions = {key: item for key, item in self._questions.items() if item["session_id"] != session_id}
            atomic_write_json(self._questions_path, self._questions)
            self._messages_path(session_id).unlink(missing_ok=True)
            for record in self._dispatches.values():
                if record.get("session_id") == session_id:
                    self._undo.discard(record.get("undo"))
        return removed

    def messages(self, session_id: str) -> list[JsonObject]:
        with self._lock:
            return [dict(m) for m in self._read_messages(session_id)]

    def mark_interrupted_turns(self) -> int:
        marked = 0
        with self._lock:
            for session_id in list(self._sessions):
                pending = {a["call_id"] for a in self.pending_approvals(session_id)}
                messages = self._read_messages(session_id)
                changed = False
                for msg in messages:
                    for call in msg.get("tool_calls") or []:
                        if call.get("status") in ("queued", "running", "pending") and call["id"] not in pending:
                            call.update(status="interrupted", result=_INTERRUPTED_RESULT)
                            changed = True
                partial = self._sessions[session_id].pop("_partial_text", "")
                if (
                    partial and messages and messages[-1].get("role") == "assistant"
                    and not messages[-1].get("tool_calls")
                    and str(messages[-1].get("content") or "").startswith(partial)
                ):
                    partial = ""
                interrupted = bool(messages and (
                    messages[-1].get("role") in ("user", "tool_result")
                    or messages[-1].get("tool_calls")
                ))
                if not pending and (partial or interrupted):
                    messages.append({
                        "role": "assistant",
                        "content": (f"{partial}\n\n" if partial else "") + (
                            "⚠ El turno anterior quedó interrumpido al cerrar la aplicación. "
                            "Comprueba las acciones antes de continuar; no se han repetido automáticamente."
                        ),
                        "ts": _now_ms(),
                    })
                    marked += 1
                    changed = True
                if changed:
                    self._write_messages(session_id, messages)
            self._write_sessions()
        return marked

    def save_partial(self, session_id: str, text: str) -> None:
        with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id]["_partial_text"] = text
                self._write_sessions()

    def append_message(self, session_id: str, message: JsonObject) -> None:
        with self._lock:
            if session_id not in self._sessions:
                return
            messages = self._read_messages(session_id)
            messages.append({**message, "ts": _now_ms()})
            self._write_messages(session_id, messages)
            session = self._sessions.get(session_id)
            if session is not None and message.get("role") == "assistant":
                session.pop("_partial_text", None)
            if (
                message.get("role") == "user"
                and session is not None
                and session.get("title") == "Conversación"
                and message.get("content")
            ):
                session["title"] = str(message["content"]).strip()[:60] or "Conversación"
            self.touch_session(session_id)

    def update_tool_call(self, session_id: str, call_id: str, status: str, result: str) -> None:
        with self._lock:
            messages = self._read_messages(session_id)
            for msg in reversed(messages):
                for call in msg.get("tool_calls") or []:
                    if call.get("id") == call_id:
                        call["status"] = status
                        call["result"] = result[:_MAX_TOOL_RESULT_CHARS]
                        self._write_messages(session_id, messages)
                        return

    def add_grants(self, session_id: str, records: list[JsonObject]) -> None:
        with self._lock:
            session_grants = self._grants.setdefault(session_id, {})
            for record in records:
                key = str(record["key"]) if record.get("key") else resource_grants.grant_key(record)
                session_grants[key] = record
            self._write_grants()

    def drafts_dir(self, session_id: str) -> Path:
        safe = "".join(ch for ch in session_id if ch.isalnum() or ch in "-_")[:64]
        if not safe:
            raise ValueError("Sesión de agente no válida")
        return self._drafts_root / safe

    def workspace_dir(self, session_id: str) -> Path:
        """Raíz de la conversación: la carpeta adjunta activa o, sin ella, los borradores."""
        for grant in self.grants_for(session_id).values():
            if grant.get("mode") == "folder" and grant.get("active"):
                try:
                    stat = os.stat(str(grant["path"]))
                except OSError:
                    break
                if (grant.get("dev"), grant.get("ino")) == (stat.st_dev, stat.st_ino) and Path(grant["path"]).is_dir():
                    return Path(str(grant["path"]))
                break
        return self.drafts_dir(session_id)

    def set_workspace(self, session_id: str, path: str | None) -> str | None:
        with self._lock:
            grants = self._grants.get(session_id) or {}
            target = os.path.normcase(path) if path else None
            if target is not None and not any(
                    g.get("mode") == "folder" and os.path.normcase(str(g["path"])) == target for g in grants.values()):
                raise ValueError("La carpeta no está adjunta a esta conversación")
            active = None
            for grant in grants.values():
                if grant.get("mode") == "folder" and target is not None and os.path.normcase(str(grant["path"])) == target:
                    grant["active"] = True
                    active = str(grant["path"])
                else:
                    grant.pop("active", None)
            self._write_grants()
            return active

    def grants_for(self, session_id: str) -> dict[str, JsonObject]:
        with self._lock:
            return {key: dict(value) for key, value in (self._grants.get(session_id) or {}).items()}

    def revoke_grant(self, session_id: str, path: str) -> int:
        with self._lock:
            grants = self._grants.get(session_id) or {}
            keys = [key for key, record in grants.items() if str(record.get("path")) == path]
            for key in keys:
                del grants[key]
            if keys:
                self._write_grants()
            return len(keys)

    def accounts_for(self, session_id: str) -> list[str]:
        with self._lock:
            found = {str((a.get("context") or {}).get("account")) for a in self._approvals.values()
                     if a.get("session_id") == session_id and a.get("status") == "approved"
                     and (a.get("context") or {}).get("account")}
            return sorted(found)

    def revoke_grants(self, session_id: str) -> int:
        with self._lock:
            removed = self._grants.pop(session_id, None)
            if removed is not None:
                self._write_grants()
            return len(removed or {})

    def add_artifact(self, session_id: str, artifact: JsonObject, *, expected_revision: str | None = None) -> JsonObject:
        record = {**artifact, "session_id": session_id, "created_at": _now_ms()}
        with self._lock:
            entry = self._artifacts.get(session_id, {"items": []})
            existing = next((item for item in entry["items"] if item["id"] == record["id"]), None)
            if expected_revision is not None:
                if existing is None or existing.get("kind") != "page" or existing["template_revision"] != expected_revision:
                    raise ValueError("La página cambió; lee artifacts_list antes de actualizarla")
                record["created_at"] = existing["created_at"]
                updated = {**entry, "items": [record if item is existing else item for item in entry["items"]]}
                atomic_write_json(self._artifacts_path, {**self._artifacts, session_id: updated})
                self._artifacts[session_id] = updated
                return dict(record)
            if existing is not None:
                return dict(existing)
            updated = {**entry, "items": [*entry["items"], record]}
            atomic_write_json(self._artifacts_path, {**self._artifacts, session_id: updated})
            self._artifacts[session_id] = updated
        return dict(record)

    def artifacts_for(self, session_id: str) -> list[JsonObject]:
        with self._lock:
            items = [dict(item) for item in (self._artifacts.get(session_id) or {}).get("items", [])]
            for item in items:
                match = next(
                    (record for record in self._dispatches.values()
                     if record.get("session_id") == session_id and record.get("artifact_id") == item.get("id")),
                    None,
                )
                if match is not None:
                    item["receipt"] = {
                        "channel": match.get("channel"),
                        "approval_source": match.get("approval_source"),
                        "status": match.get("status"),
                    }
            return items

    def review_artifact(self, session_id: str, artifact_id: str, index: int, sha256: str) -> None:
        with self._lock:
            for item in (self._artifacts.get(session_id) or {}).get("items", []):
                if item["id"] == artifact_id:
                    item.setdefault("reviewed", {})[str(index)] = sha256
                    atomic_write_json(self._artifacts_path, self._artifacts)
                    return
            raise ValueError("Artefacto no encontrado")

    def dispatch_note(self, session_id: str, op_id: str, note: JsonObject) -> None:
        with self._lock:
            for record in self._dispatches.values():
                if record.get("op_id") == op_id and record.get("session_id") == session_id:
                    record.update(note)
                    self._write_dispatches()
                    return
            raise ValueError("La operación de impresión no está reservada")

    def profile_usage(self, profile_id: str, day: str) -> int:
        with self._lock:
            return sum(int((usage.get("days") or {}).get(day) or 0)
                       for record in self._dispatches.values()
                       if isinstance(usage := record.get("subagent_usage"), dict)
                       and usage.get("profile_id") == profile_id)

    def add_question(self, session_id: str, op_id: str, params: JsonObject) -> JsonObject:
        from backend.core.agent.questions import validate

        items = validate(params)
        with self._lock:
            question = {"id": op_id, "session_id": session_id, "questions": items, "status": "pending", "answers": {}}
            self._questions[op_id] = question
            atomic_write_json(self._questions_path, self._questions)
            return dict(question)

    def questions_for(self, session_id: str) -> list[JsonObject]:
        with self._lock:
            return [dict(item) for item in self._questions.values() if item.get("session_id") == session_id and item.get("status") == "pending"]

    def answer_question(self, session_id: str, question_id: str, answers: JsonObject) -> JsonObject:
        with self._lock:
            item = self._questions.get(question_id)
            if item is None or item.get("session_id") != session_id or item.get("status") != "pending":
                raise ValueError("La pregunta ya no está activa en esta conversación")
            keys = {question["id"] for question in item["questions"]}
            if not isinstance(answers, dict) or set(answers) != keys or any(not isinstance(value, str) or not value.strip() or len(value) > 12000 for value in answers.values()):
                raise ValueError("Responde todos los datos solicitados")
            item.update({"answers": answers, "status": "answered"})
            atomic_write_json(self._questions_path, self._questions)
            return dict(item)

    def attention(self) -> JsonObject:
        with self._lock:
            states = {str(record["session_id"]): "uncertain" for record in self._dispatches.values() if record["status"] == "uncertain"}
            states.update({str(item["session_id"]): "waiting_approval" for item in self.pending_approvals()})
            states.update({str(item["session_id"]): "waiting_input" for item in self._questions.values() if item["status"] == "pending"})
            return states

    def create_approval(self, session_id: str, call: JsonObject) -> JsonObject:
        approval = {
            "id": uuid.uuid4().hex[:12],
            "session_id": session_id,
            "call_id": call["id"],
            "method": call["name"],
            "params": call.get("params") or {},
            "fingerprint": call.get("fingerprint") or fingerprint(str(call["name"]), call.get("params") or {}),
            "status": "pending",
            "created_at": _now_ms(),
            "decided_at": None,
            "channel": call.get("channel") or None,
            "context": call.get("context") or {},
            "resources": call.get("resources") or [],
        }
        with self._lock:
            self._approvals[approval["id"]] = approval
            self._write_approvals()
        return approval

    def _expire_stale_approvals(self) -> None:
        with self._lock:
            now = _now_ms()
            stale = [
                a for a in self._approvals.values()
                if a.get("status") in {"pending", "approved"} and not a.get("consumed_by")
                and now - float(a.get("created_at") or now) > _APPROVAL_TTL_MS
            ]
            if not stale:
                return
            for approval in stale:
                approval["status"] = "expired"
                approval["decided_at"] = now
            self._write_approvals()

    def pending_approvals(self, session_id: str | None = None) -> list[JsonObject]:
        self._expire_stale_approvals()
        with self._lock:
            out = [
                dict(a)
                for a in self._approvals.values()
                if a.get("status") == "pending" and (session_id is None or a.get("session_id") == session_id)
            ]
            return sorted(out, key=lambda a: a.get("created_at") or 0)

    def get_approval(self, approval_id: str) -> JsonObject | None:
        with self._lock:
            approval = self._approvals.get(approval_id)
            return dict(approval) if isinstance(approval, dict) else None

    def approval_history(
        self,
        *,
        session_id: str | None = None,
        method: str | None = None,
        status: str | None = None,
        limit: int = 500,
    ) -> list[JsonObject]:
        self._expire_stale_approvals()
        wanted = status if status in {"pending", "approved", "denied", "expired", "uncertain"} else None
        with self._lock:
            records: list[JsonObject] = []
            for approval in self._approvals.values():
                if session_id and approval.get("session_id") != session_id:
                    continue
                if method and approval.get("method") != method:
                    continue
                dispatch = self._dispatches.get(
                    dispatch_key(str(approval.get("session_id")), str(approval.get("call_id") or ""))
                )
                if wanted == "uncertain":
                    if not isinstance(dispatch, dict) or dispatch.get("status") != "uncertain":
                        continue
                elif wanted and approval.get("status") != wanted:
                    continue
                record = dict(approval)
                if isinstance(dispatch, dict):
                    record["dispatch"] = {
                        key: dispatch.get(key) for key in ("status", "finished_at") if dispatch.get(key) is not None
                    }
                records.append(record)
        records.sort(key=lambda item: float(item.get("created_at") or 0), reverse=True)
        return records[: max(1, min(int(limit), 1000))]

    def decide_approval(self, approval_id: str, approved: bool, source: str = "manual") -> JsonObject | None:
        self._expire_stale_approvals()
        with self._lock:
            approval = self._approvals.get(approval_id)
            if approval is None or approval.get("status") != "pending":
                return None
            approval["status"] = "approved" if approved else "denied"
            approval["source"] = source
            approval["decided_at"] = _now_ms()
            self._write_approvals()
            return dict(approval)

    def approval_for_call(self, session_id: str, call_id: str) -> JsonObject | None:
        self._expire_stale_approvals()
        with self._lock:
            for approval in self._approvals.values():
                if approval.get("session_id") == session_id and approval.get("call_id") == call_id:
                    return dict(approval)
            return None

    def ensure_approval(self, session_id: str, call: JsonObject) -> JsonObject:
        with self._lock:
            return self.approval_for_call(session_id, str(call["id"])) or self.create_approval(session_id, call)

    def expire_approval(self, approval_id: str) -> None:
        with self._lock:
            approval = self._approvals.get(approval_id)
            if isinstance(approval, dict) and approval.get("status") == "pending":
                approval["status"] = "expired"
                approval["decided_at"] = _now_ms()
                self._write_approvals()

    def deny_pending_approvals(self, session_id: str) -> list[str]:
        self._expire_stale_approvals()
        with self._lock:
            denied: list[str] = []
            for approval in self._approvals.values():
                if approval.get("session_id") == session_id and approval.get("status") == "pending":
                    approval["status"] = "denied"
                    approval["source"] = "cancel"
                    approval["decided_at"] = _now_ms()
                    denied.append(str(approval["id"]))
            if denied:
                self._write_approvals()
            return denied

    def dispatches_for(self, session_id: str) -> list[JsonObject]:
        with self._lock:
            return [{k: v for k, v in record.items() if k != "result"}
                    for record in self._dispatches.values() if record.get("session_id") == session_id]

    def get_dispatch(self, session_id: str, call_id: str) -> JsonObject | None:
        with self._lock:
            record = self._dispatches.get(dispatch_key(session_id, call_id))
            return dict(record) if isinstance(record, dict) else None

    def dispatch_claim(
        self, session_id: str, call_id: str, method: str, params: JsonObject, approval_id: str | None,
        *, channel: str | None = None, approval_source: str | None = None,
    ) -> tuple[str, JsonObject]:
        intent = fingerprint(method, params)
        key = dispatch_key(session_id, call_id)
        with self._lock:
            existing = self._dispatches.get(key)
            if isinstance(existing, dict):
                same = existing.get("method") == method and existing.get("fingerprint") in (None, intent)
                if not (same and existing.get("status") == "uncertain" and replay_safe(method)):
                    return ("existing" if same else "conflict"), dict(existing)
            approval = None
            if approval_id is not None:
                self._expire_stale_approvals()
                approval = self._approvals.get(approval_id)
                error = None
                if (approval is None or approval.get("status") != "approved"
                        or approval.get("session_id") != session_id or approval.get("call_id") != call_id
                        or approval.get("method") != method):
                    error = "La herramienta requiere una aprobación aprobada para esta llamada"
                elif (approval.get("fingerprint")
                      or fingerprint(str(approval.get("method")), approval.get("params") or {})) != intent:
                    error = "Los parámetros no coinciden con los aprobados; vuelve a pedir aprobación"
                elif approval.get("consumed_by"):
                    error = "Esta aprobación ya se usó en otra ejecución"
                if error:
                    return "rejected", {"error": error}
            record: JsonObject = {
                "op_id": uuid.uuid4().hex,
                "call_id": call_id,
                "session_id": session_id,
                "method": method,
                "fingerprint": intent,
                "approval_id": approval_id,
                "approval_source": approval_source
                or (approval.get("source") if approval is not None else None)
                or ("manual" if approval is not None else "none"),
                "channel": channel or (approval.get("channel") if approval is not None else None),
                "status": "running",
                "started_at": _now_ms(),
                "result": None,
                "summary": None,
            }
            self._dispatches[key] = record
            self._write_dispatches()
            if approval is not None:
                approval["consumed_by"] = record["op_id"]
                self._write_approvals()
            return "new", dict(record)

    def dispatch_finish(self, session_id: str, call_id: str, op_id: str, status: str, result: str) -> None:
        with self._lock:
            record = self._dispatches.get(dispatch_key(session_id, call_id))
            if record is None or record.get("status") not in {"running", "uncertain"} or record.get("op_id") != op_id:
                return
            record["status"] = status
            if len(result) > _MAX_RECEIPT_CHARS:
                receipt = self._dispatches_path.parent / "receipts" / f"{op_id}.json"
                atomic_write_json(receipt, {"result": result})
                record["result_ref"] = str(receipt)
                record["result"] = summarize_result(result)
            else:
                record["result"] = result
            record["summary"] = summarize_result(result)
            record["finished_at"] = _now_ms()
            self._write_dispatches()

    def undo_prepare(self, session_id: str, call_id: str, op_id: str, method: str, resources: list[JsonObject]) -> None:
        undo = self._undo.prepare(op_id, method, resources)
        if undo is None:
            return
        with self._lock:
            record = self._dispatches.get(dispatch_key(session_id, call_id))
            if record is None or record.get("op_id") != op_id:
                self._undo.discard(undo)
                return
            record["undo"] = undo
            self._write_dispatches()

    def undo_finish(self, session_id: str, call_id: str, op_id: str) -> None:
        with self._lock:
            record = self._dispatches.get(dispatch_key(session_id, call_id))
            if record is None or record.get("op_id") != op_id or record.get("undo") is None:
                return
            record["undo"] = self._undo.finish(record.get("undo"))
            self._write_dispatches()

    def undo_effect(self, session_id: str, call_id: str) -> JsonObject:
        with self._lock:
            record = self._dispatches.get(dispatch_key(session_id, call_id))
            if record is None:
                raise ValueError("La acción ya no está disponible en esta conversación")
            undo = record.get("undo")
            if not isinstance(undo, dict) or not undo.get("available"):
                raise ValueError((undo or {}).get("reason") or "Esta acción no se puede deshacer")
            if undo.get("undone_at"):
                raise ValueError("Esta acción ya se deshizo")
            if record.get("status") != "succeeded":
                raise ValueError("Solo se pueden deshacer acciones completadas")
            self._undo.restore(undo)
            undo["undone_at"] = _now_ms()
            self._undo.discard(undo)
            self._write_dispatches()
            return {"undone": True, "path": undo.get("path"), "call_id": call_id}


class AgentRunner:
    def __init__(
        self,
        store: AgentStore,
        handler_getter: Callable[[str], Callable[[JsonObject], JsonObject] | None],
    ) -> None:
        self._store = store
        self._handler_getter = handler_getter
        self._store.mark_interrupted_turns()

    def _subagent_approval(
        self,
        session_id: str,
        name: str,
        params: JsonObject,
        agent_name: str,
        token: _CancelEvent | None,
    ) -> str | None:
        approval = self._store.ensure_approval(
            session_id,
            {
                "id": f"sub-{uuid.uuid4().hex[:12]}",
                "name": name,
                "params": params,
                "context": {"subagent": agent_name, "subagent_role": "worker"},
            },
        )
        approval_id = str(approval["id"])
        try:
            while True:
                if token is not None and token.cancelled:
                    raise RunCancelled()
                current = self._store.get_approval(approval_id)
                status = str((current or {}).get("status") or "expired")
                if status != "pending":
                    break
                if token is None:
                    time.sleep(0.2)
                elif token.wait(0.2):
                    raise RunCancelled()
        except RunCancelled:
            self._store.expire_approval(approval_id)
            raise
        if status == "approved":
            return None
        if status == "denied":
            return json.dumps({"error": "El usuario rechazó esta acción del subagente"}, ensure_ascii=False)
        return json.dumps({"error": "La aprobación del subagente expiró; vuelve a intentarlo"}, ensure_ascii=False)

    def _run_subagent(self, call: JsonObject, token: _CancelEvent | None = None) -> str:
        profile = call.get("subagent")
        session_id = str(call.get("session_id") or "")
        raw_params = call.get("params")
        params: JsonObject = raw_params if isinstance(raw_params, dict) else {}
        session = self._store.get_session(session_id) if session_id else None
        if not isinstance(profile, dict) or not str(profile.get("name") or "").strip():
            return json.dumps({"error": "No hay un agente guardado disponible para esta delegación"}, ensure_ascii=False)
        provider = str(profile.get("provider") or (session or {}).get("provider") or "")
        model = str(profile.get("model") or (session or {}).get("model") or "")
        if session is None and (not provider or not model):
            return json.dumps({"error": "El subagente necesita una conversación activa"}, ensure_ascii=False)
        try:
            tasks = subagent.normalize_tasks(profile, params)
        except ValueError as err:
            return json.dumps({"error": str(err)[:300]}, ensure_ascii=False)
        specs = tool_specs()
        results: list[JsonObject] = []
        usage: JsonObject = {"input": 0, "output": 0}
        usage_days: dict[str, int] = {}

        def record_usage(current: JsonObject) -> None:
            for key in usage:
                usage[key] += int(current.get(key) or 0)
            day = date.today().isoformat()
            usage_days[day] = usage_days.get(day, 0) + sum(int(current.get(key) or 0) for key in usage)
            if call.get("op_id"):
                self._store.dispatch_note(session_id, str(call["op_id"]), {
                    "subagent_usage": {"profile_id": profile.get("id"), "days": dict(usage_days)},
                })

        for task in tasks:
            allowed = set(
                subagent.allowed_tool_names(
                    profile.get("tools"),
                    profile.get("enabled"),
                    role=str(task["role"]),
                    exclude_tools=task["exclude_tools"],
                )
            )
            offered = [spec for spec in specs if str(spec.get("name") or "") in allowed]
            offered_names = {str(spec.get("name") or "") for spec in offered}
            gated = {str(spec.get("name") or "") for spec in offered if spec.get("gated")}

            def execute(name: str, args: JsonObject, *, _offered=offered_names, _gated=gated) -> str:
                if name not in _offered:
                    return json.dumps(
                        {"error": f"Herramienta no disponible para el subagente: {name}"},
                        ensure_ascii=False,
                    )
                if name in _gated:
                    rejected = self._subagent_approval(
                        session_id, name, args, str(profile.get("name") or "Subagente"), token,
                    )
                    if rejected is not None:
                        return rejected
                return self._execute(
                    {"id": f"sub-{uuid.uuid4().hex[:12]}", "name": name, "params": args,
                     "session_id": session_id, "profile_id": profile.get("id"),
                     "memory_scope": profile.get("memory_scope")}, token,
                )

            try:
                results.append(
                    subagent.run(
                        provider=provider,
                        model=model,
                        agent=profile,
                        task=str(task["task"]),
                        tools=offered,
                        execute=execute,
                        role=str(task["role"]),
                        output_schema=task.get("output_schema"),
                        cancelled=(lambda: token.cancelled) if token is not None else None,
                        remaining_tokens=(max(0, int(profile["remaining_tokens"]) - sum(usage.values()))
                                          if profile.get("remaining_tokens") is not None else None),
                        on_usage=record_usage,
                    )
                )
            except RunCancelled:
                raise
            except Exception as err:
                return json.dumps({"error": str(err)[:300], **({"usage": usage} if any(usage.values()) else {})}, ensure_ascii=False)
        receipt = results[0] if params.get("tasks") is None else subagent.group_receipt(profile, results)
        if any(usage.values()):
            receipt["usage"] = usage
        return json.dumps(scrub_secrets(receipt), ensure_ascii=False)

    def _execute(self, call: JsonObject, token: _CancelEvent | None = None) -> str:
        if token is not None and token.cancelled:
            raise RunCancelled()
        name = str(call.get("name") or "")
        if name == subagent.TOOL_NAME:
            return self._run_subagent(call, token)
        if name == "ask_user":
            question = self._store.add_question(str(call["session_id"]), str(call["op_id"]), call["params"])
            while True:
                with self._store._lock:
                    current = dict(self._store._questions.get(question["id"]) or {"status": "cancelled"})
                if current["status"] == "cancelled":
                    raise RunCancelled()
                if current["status"] == "answered":
                    return json.dumps({"answers": current["answers"]}, ensure_ascii=False)
                if token and token.wait(0.1):
                    with self._store._lock:
                        if question["id"] in self._store._questions:
                            self._store._questions[question["id"]]["status"] = "cancelled"
                        atomic_write_json(self._store._questions_path, self._store._questions)
                    raise RunCancelled()
                if token is None:
                    time.sleep(0.1)
        if name == "artifact_print":
            from backend.core.agent.artifacts import print_artifact

            try:
                return json.dumps(print_artifact(self._store, str(call["session_id"]), call["params"], str(call["op_id"]),
                                                cancelled=(lambda: token.cancelled) if token else None), ensure_ascii=False)
            except Exception:
                record = self._store.get_dispatch(str(call["session_id"]), str(call["id"]))
                if record and record.get("job_id"):
                    raise RunCancelled() from None
                raise
        mcp_ref = mcp_servers.parse_agent_tool(name)
        if mcp_ref is not None:
            params = call.get("params")
            try:
                options = {"approved_context": call["approved_context"]} if "approved_context" in call else {}
                if token:
                    options["cancelled"] = lambda: token.cancelled
                result = mcp_servers.call_tool(mcp_ref[0], name, params if isinstance(params, dict) else {}, advertised=True,
                                               **options)
                return json.dumps(scrub_secrets(result), ensure_ascii=False, default=str)
            except (mcp_servers.mcp_client.McpCancelled, mcp_servers.mcp_client.McpUncertain):
                raise RunCancelled() from None
            except Exception as err:
                return json.dumps({"error": str(err)[:500]}, ensure_ascii=False)
        session_id = call.get("session_id")
        if name in agent_tools.SPECS:
            try:
                if not session_id:
                    raise ValueError("Esta herramienta requiere una conversación")
                raw_params = call.get("params")
                tool_args: JsonObject = dict(raw_params) if isinstance(raw_params, dict) else {}
                result = agent_tools.run(name, tool_args, self._store, str(session_id), token,
                                         profile_id=call.get("profile_id"), memory_scope=call.get("memory_scope"),
                                         profile_skills=call.get("profile_skills"))
                return json.dumps(scrub_secrets(result), ensure_ascii=False, default=str).encode(
                    "utf-8", errors="backslashreplace").decode("utf-8")
            except RunCancelled:
                raise
            except Exception as err:
                return json.dumps({"error": str(err)[:500]}, ensure_ascii=False)
        fn = self._handler_getter(name)
        if fn is None:
            return json.dumps({"error": f"Método desconocido: {name}"})
        params = call.get("params")
        try:
            args = dict(params) if isinstance(params, dict) else {}
            grants = self._store.grants_for(str(session_id)) if session_id else {}
            drafts_root = self._store.drafts_dir(str(session_id)) if session_id else None
            if drafts_root is not None:
                args = drafts.bind_outputs(args, _write_keys(name), drafts_root)
            granted = {str(r["value"]) for r in read_resources(name, args, grants, drafts_root)}
            granted |= {str(args[k]) for k in _write_keys(name) if isinstance(args.get(k), str) and args[k]}

            def check_paths(value: object) -> None:
                if isinstance(value, dict):
                    for key, child in value.items():
                        if key in ("_file_grants", "_flow_file_grants") or key.startswith("_resolved_"):
                            raise ValueError("El agente no puede concederse permisos de archivos")
                        check_paths(child)
                elif isinstance(value, list):
                    for child in value:
                        check_paths(child)
                elif isinstance(value, str) and ntpath.isabs(value) and value not in granted:
                    raise ValueError("Usa los diálogos de Antares para autorizar archivos; la aprobación no autoriza rutas")

            check_paths(args)
            _validate_action_paths(name, args, grants, drafts_root)
            lane = lane_for(name)
            if lane == "sync":
                result = fn(args)
            else:
                scheduler = get_scheduler()
                future = scheduler.submit_heavy(fn, args) if lane == "heavy" else scheduler.submit_light(fn, args)
                if future is None:
                    raise ValueError("No se pudo programar la herramienta")
                try:
                    result = await_or_cancel(lambda: future.result(timeout=timeout_ms_for(name) / 1000), token)
                except RunCancelled:
                    future.cancel()
                    raise
                except FutureTimeoutError:
                    future.cancel()
                    raise ValueError("La herramienta excedió su tiempo; puede seguir ejecutándose, comprueba el resultado antes de repetirla") from None
            if session_id and isinstance(result, dict):
                from backend.core.agent.artifacts import backend_pdf

                result = backend_pdf(self._store, str(session_id), name, result, str(call.get("op_id") or uuid.uuid4().hex))
            return json.dumps(scrub_secrets(result), ensure_ascii=False, default=str)
        except RunCancelled:
            raise
        except Exception as err:
            return json.dumps({"error": str(err)[:500]}, ensure_ascii=False)

_store_lock = threading.RLock()
_store_singleton: AgentStore | None = None
_runner_singleton: AgentRunner | None = None


def get_agent_store() -> AgentStore:
    global _store_singleton
    with _store_lock:
        if _store_singleton is None:
            _store_singleton = AgentStore()
        return _store_singleton


def get_agent_runner() -> AgentRunner:
    global _runner_singleton
    with _store_lock:
        if _runner_singleton is None:
            from backend.handlers import HANDLERS

            _runner_singleton = AgentRunner(get_agent_store(), HANDLERS.get)
        return _runner_singleton
