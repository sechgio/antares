import json
import threading
import time
from pathlib import Path

import pytest

from backend.core.agent import agent, agent_chat, memory, subagent
from backend.core.agent.cancel import RunCancelled, _CancelEvent
from backend.handlers import agent_internal


def _session(tmp_path):
    store = agent.AgentStore(tmp_path)
    session = store.create_session("ollama", "llama3.1", "Prueba")
    return store, session


def _profile(**overrides):
    return {
        "id": "perfil-1",
        "name": "Investigador",
        "instructions": "Consulta el catálogo y resume.",
        "tools": ["canvas_list"],
        **overrides,
    }


def _call(session, **overrides):
    return {
        "id": "c1",
        "name": subagent.TOOL_NAME,
        "params": {"agent": "Investigador", "task": "¿Qué plantillas hay?"},
        "session_id": session["id"],
        "subagent": _profile(),
        **overrides,
    }


def test_subagent_ejecuta_lecturas_y_devuelve_traza(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    replies = [
        {"text": "", "calls": [{"id": "t1", "name": "canvas_list", "params": {"include": "all"}}]},
        {"text": "Hay tres plantillas.", "calls": []},
    ]
    offered = []

    def fake_chat(provider, model, messages, system=None, tools=None, **kwargs):
        offered.append([spec["name"] for spec in tools or []])
        return replies.pop(0)

    executed = []

    def handler(name):
        return lambda params: executed.append((name, params)) or {"documents": ["a", "b"]}

    monkeypatch.setattr(agent_chat, "chat", fake_chat)
    runner = agent.AgentRunner(store, handler)
    receipt = json.loads(runner._execute(_call(session), None))

    assert receipt["status"] == "done"
    assert receipt["text"] == "Hay tres plantillas."
    assert receipt["agent"] == {"id": "perfil-1", "name": "Investigador"}
    assert receipt["steps"] == [{"name": "canvas_list", "status": "done"}]
    assert executed == [("canvas_list", {"include": "all"})]
    assert offered[0] == ["canvas_list"]


@pytest.mark.parametrize(("scope", "expected"), [
    ("own", {"Memoria del hijo"}),
    ("shared-read", {"Memoria del hijo", "Memoria general"}),
    ("none", set()),
])
def test_subagent_busca_memoria_del_perfil_sin_cambiar_la_del_padre(tmp_path, monkeypatch, scope, expected):
    store, session = _session(tmp_path)
    memories = memory.memory_for(store)
    for sid, profile_id, content in [(session["id"], "padre", "Memoria del padre"),
                                     ("child", "hijo", "Memoria del hijo"),
                                     ("global", None, "Memoria general")]:
        memories.context(sid, "", {}, profile_id=profile_id, memory_scope="own" if profile_id else None)
        memories.remember(sid, {"kind": "fact", "title": "Datoauditoria", "content": content})
    observed = []

    def chat(provider, model, messages, **kwargs):
        if messages[-1]["role"] == "tool_result":
            observed.extend(json.loads(messages[-1]["content"])["items"])
            return {"text": "Consulta finalizada", "calls": []}
        return {"calls": [{"id": "m1", "name": "memory_search", "params": {"query": "Datoauditoria"}}]}

    monkeypatch.setattr(agent_chat, "chat", chat)
    runner = agent.AgentRunner(store, lambda name: None)
    runner._execute(_call(session, subagent=_profile(id="hijo", memory_scope=scope, tools=["memory_search"])), None)
    assert {item["content"] for item in observed} == expected
    assert {item["content"] for item in memories.search("Datoauditoria", session_id=session["id"])} == {"Memoria del padre"}


@pytest.mark.parametrize("remaining", [0, 10])
def test_subagent_respeta_presupuesto_y_devuelve_consumo(tmp_path, monkeypatch, remaining):
    store, session = _session(tmp_path)
    replies = []

    def chat(*args, **kwargs):
        replies.append(True)
        return {"text": "", "calls": [{"id": "t1", "name": "canvas_list", "params": {}}],
                "usage": {"input": 8, "output": 3}}

    monkeypatch.setattr(agent_chat, "chat", chat)
    runner = agent.AgentRunner(store, lambda name: lambda params: {"documents": []})
    receipt = json.loads(runner._execute(_call(session, subagent=_profile(remaining_tokens=remaining)), None))
    assert len(replies) == (1 if remaining else 0)
    assert receipt["status"] == "token_budget"
    assert receipt.get("usage", {"input": 0, "output": 0}) == {
        "input": 8 if remaining else 0, "output": 3 if remaining else 0,
    }


def test_subagente_no_ejecuta_efectos_ni_se_ofrece_a_si_mismo(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    replies = [
        {"text": "", "calls": [{"id": "t1", "name": "db_clear", "params": {}}]},
        {"text": "No puedo borrar datos.", "calls": []},
    ]
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: replies.pop(0))
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(name) or {})
    receipt = json.loads(runner._execute(_call(session), None))

    assert executed == []
    assert receipt["steps"] == [{
        "name": "db_clear",
        "status": "failed",
        "detail": "Herramienta no disponible para el subagente: db_clear",
    }]
    allowed = subagent.allowed_tool_names(["db_clear", "canvas_save", subagent.TOOL_NAME, "canvas_list"], None)
    assert allowed == ["canvas_list"]
    assert "memory_remember" not in subagent.allowed_tool_names(None, None)
    assert "procedure_learn" not in subagent.allowed_tool_names(None, None)
    assert "ask_user" not in subagent.allowed_tool_names(None, None)


def test_roles_amplian_solo_el_worker_y_permiten_sustraer_herramientas():
    explorer = set(subagent.allowed_tool_names(None, None))
    reviewer = set(subagent.allowed_tool_names(None, None, role="reviewer"))
    worker = set(subagent.allowed_tool_names(None, None, role="worker"))

    assert explorer == reviewer
    assert "canvas_list" in explorer
    assert "canvas_create" not in explorer
    assert "canvas_create" in worker
    assert "artifact_print" not in worker
    assert set(subagent.allowed_tool_names(None, None, exclude_tools=["canvas_list"])) == explorer - {"canvas_list"}


def test_resolver_rol_exige_worker_opt_in():
    assert subagent.resolve_role(None, None) == "explorer"
    assert subagent.resolve_role("reviewer", None) == "reviewer"
    assert subagent.resolve_role("worker", "worker") == "worker"
    with pytest.raises(ValueError, match="configurado como worker"):
        subagent.resolve_role("explorer", "worker")
    with pytest.raises(ValueError, match="Rol de subagente no válido"):
        subagent.normalize_role("admin")


def test_agrupa_encargos_y_aplica_el_rol_del_perfil():
    profile = _profile(role="reviewer")
    tasks = subagent.normalize_tasks(profile, {"tasks": [
        {"task": "Revisa A"},
        {"task": "Revisa B", "role": "explorer", "exclude_tools": ["canvas_list"],
         "output_schema": {"type": "object"}},
    ]})

    assert [task["role"] for task in tasks] == ["reviewer", "explorer"]
    assert tasks[1]["exclude_tools"] == ["canvas_list"]
    with pytest.raises(ValueError, match="task o tasks"):
        subagent.normalize_tasks(profile, {"task": "A", "tasks": [{"task": "B"}]})
    with pytest.raises(ValueError, match="entre 1 y 4"):
        subagent.normalize_tasks(profile, {"tasks": [{"task": str(index)} for index in range(5)]})
    with pytest.raises(ValueError, match="exclude_tools"):
        subagent.normalize_tasks(profile, {"task": "A", "exclude_tools": "canvas_list"})
    with pytest.raises(ValueError, match="worker"):
        subagent.normalize_tasks(_profile(), {"task": "A", "role": "worker"})


def test_subagente_respeta_herramientas_habilitadas_en_la_conversacion(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: {"text": "sin herramientas", "calls": []})
    runner = agent.AgentRunner(store, lambda name: lambda params: {})
    receipt = json.loads(runner._execute(_call(session, subagent=_profile(enabled=[])), None))

    assert receipt["status"] == "done"
    assert subagent.allowed_tool_names(["canvas_list"], []) == []


def test_subagente_corta_al_llegar_al_limite(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    monkeypatch.setattr(
        agent_chat,
        "chat",
        lambda *args, **kwargs: {"text": "", "calls": [{"id": "t", "name": "canvas_list", "params": {}}]},
    )
    runner = agent.AgentRunner(store, lambda name: lambda params: {"ok": True})
    receipt = json.loads(runner._execute(_call(session), None))

    assert receipt["status"] == "limit"
    assert len(receipt["steps"]) == subagent.MAX_STEPS
    assert len(json.dumps(receipt, ensure_ascii=False)) <= subagent.MAX_RECEIPT_CHARS

def test_contrato_de_salida_valida_json_y_reintenta_una_vez(monkeypatch):
    replies = [
        {"text": "No es JSON", "calls": []},
        {"text": "```json\n{\"total\": 3}\n```", "calls": []},
    ]
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: replies.pop(0))
    receipt = subagent.run(
        provider="faux", model="current", agent=_profile(), task="Cuenta",
        tools=[], execute=lambda name, params: "{}",
        output_schema={
            "type": "object",
            "properties": {"total": {"type": "integer"}},
            "required": ["total"],
            "additionalProperties": False,
        },
    )

    assert replies == []
    assert receipt["status"] == "done"
    assert receipt["schema_valid"] is True
    assert receipt["output"] == {"total": 3}


def test_contrato_de_salida_marca_el_incumplimiento(monkeypatch):
    replies = [
        {"text": "Texto libre", "calls": []},
        {"text": "{\"total\": \"tres\"}", "calls": []},
    ]
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: replies.pop(0))
    receipt = subagent.run(
        provider="faux", model="current", agent=_profile(), task="Cuenta",
        tools=[], execute=lambda name, params: "{}",
        output_schema={"type": "object", "properties": {"total": {"type": "integer"}}, "required": ["total"]},
    )

    assert receipt["status"] == "invalid"
    assert receipt["schema_valid"] is False
    assert receipt["schema_error"].startswith("total:")
    assert "output" not in receipt


def test_rechaza_un_json_schema_invalido():
    with pytest.raises(ValueError, match="JSON Schema"):
        subagent.validate_schema({"type": "no-existe"})


def test_agrupa_recibos_y_marca_parciales():
    done = {"status": "done", "ms": 10}
    invalid = {"status": "invalid", "ms": 5}
    group = subagent.group_receipt(_profile(), [done, invalid])

    assert group["status"] == "partial"
    assert group["results"] == [done, invalid]
    assert group["ms"] == 15
    assert group["depth"] == subagent.MAX_DEPTH
    assert subagent.group_receipt(_profile(), [done, done])["status"] == "done"
    assert subagent.group_receipt(_profile(), [invalid, invalid])["status"] == "invalid"


def _execute_waiting_for_approval(runner, call, store, session_id):
    outcome = {}

    def target():
        try:
            outcome["result"] = runner._execute(call, None)
        except BaseException as err:
            outcome["error"] = err

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    deadline = time.monotonic() + 5
    pending = []
    while time.monotonic() < deadline and not pending:
        pending = store.pending_approvals(session_id)
        time.sleep(0.02)
    assert pending, "el subagente no pidió aprobación para una herramienta con efectos"
    return thread, pending[0], outcome


def _worker_call(session):
    return _call(
        session,
        subagent=_profile(role="worker", tools=["canvas_create"]),
        params={"agent": "Investigador", "task": "Crea el canvas"},
    )


def test_worker_devuelve_la_aprobacion_a_la_conversacion_principal(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    replies = [
        {"text": "", "calls": [{"id": "t1", "name": "canvas_create", "params": {"name": "Demo"}}]},
        {"text": "No pude crear el canvas.", "calls": []},
    ]
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: replies.pop(0))
    monkeypatch.setattr(agent, "tool_specs", lambda: [{"name": "canvas_create", "gated": True}])
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append((name, params)) or {"ok": True})

    thread, approval, outcome = _execute_waiting_for_approval(runner, _worker_call(session), store, session["id"])
    assert approval["method"] == "canvas_create"
    assert approval["context"] == {"subagent": "Investigador", "subagent_role": "worker"}
    store.decide_approval(approval["id"], False)
    thread.join(5)

    assert not thread.is_alive()
    assert "error" not in outcome
    receipt = json.loads(outcome["result"])
    assert executed == []
    assert receipt["status"] == "done"
    assert receipt["steps"] == [{
        "name": "canvas_create",
        "status": "failed",
        "detail": "El usuario rechazó esta acción del subagente",
    }]


def test_worker_ejecuta_la_herramienta_aprobada_por_el_padre(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    replies = [
        {"text": "", "calls": [{"id": "t1", "name": "canvas_create", "params": {"name": "Demo"}}]},
        {"text": "Canvas creado.", "calls": []},
    ]
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: replies.pop(0))
    monkeypatch.setattr(agent, "tool_specs", lambda: [{"name": "canvas_create", "gated": True}])
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append((name, params)) or {"ok": True})

    thread, approval, outcome = _execute_waiting_for_approval(runner, _worker_call(session), store, session["id"])
    store.decide_approval(approval["id"], True)
    thread.join(5)

    assert not thread.is_alive()
    assert "error" not in outcome
    receipt = json.loads(outcome["result"])
    assert executed == [("canvas_create", {"name": "Demo"})]
    assert receipt["steps"] == [{"name": "canvas_create", "status": "done"}]
    assert receipt["text"] == "Canvas creado."


def test_dispatch_exige_el_perfil_resuelto_por_electron():
    result = agent_internal._dispatch({"session_id": "s", "call_id": "c", "name": subagent.TOOL_NAME, "params": {}})
    assert json.loads(result["result"])["error"] == "El agente indicado no está disponible para delegar"


def test_dispatch_reenvia_el_perfil_y_devuelve_el_recibo(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    seen = {}

    class Runner:
        def _execute(self, call, token=None):
            seen.update(call)
            return json.dumps({"agent": {"name": "Investigador"}, "status": "done", "text": "ok", "steps": [], "ms": 1})

    monkeypatch.setattr(agent_internal, "_store", lambda: store)
    monkeypatch.setattr(agent_internal._agent, "get_agent_runner", lambda: Runner())
    request = {
        "session_id": session["id"],
        "call_id": "c1",
        "name": subagent.TOOL_NAME,
        "params": {"agent": "Investigador", "task": "Busca documentos"},
        "context": {"subagent": _profile(enabled=["canvas_list"])},
    }
    out = agent_internal._dispatch(request)
    assert out["result"] is None and out["dispatch"]["status"] == "running"
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        out = agent_internal._dispatch_result({"session_id": session["id"], "call_id": "c1"})
        if out["dispatch"]["status"] != "running":
            break
        time.sleep(0.02)

    assert seen["subagent"]["name"] == "Investigador"
    assert seen["subagent"]["enabled"] == ["canvas_list"]
    assert json.loads(out["result"])["text"] == "ok"


@pytest.mark.parametrize("status", ["done", "empty", "limit"])
def test_recibo_siempre_es_json_serializable(status):
    receipt = subagent._trim_receipt({"status": status, "text": "x" * 10_000, "steps": [], "ms": 1})
    assert len(json.dumps(receipt, ensure_ascii=False)) <= subagent.MAX_RECEIPT_CHARS


def test_subagent_discards_final_reply_after_cancellation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store, session = _session(tmp_path)
    token = _CancelEvent()

    def chat(*args: object, **kwargs: object) -> dict[str, object]:
        token.cancel()
        return {"text": "Respuesta que llegó después de detener", "calls": []}

    monkeypatch.setattr(agent_chat, "chat", chat)
    runner = agent.AgentRunner(store, lambda name: lambda params: {})
    with pytest.raises(RunCancelled):
        runner._execute(_call(session), token)


def test_subagent_discards_limit_receipt_if_cancelled_in_the_last_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    token = _CancelEvent()
    executed = []
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: {
        "text": "En curso", "calls": [{"id": "read", "name": "canvas_list", "params": {}}],
    })

    def execute(name: str, params: dict[str, object]) -> str:
        executed.append(name)
        if len(executed) == subagent.MAX_STEPS:
            token.cancel()
        return "{}"

    with pytest.raises(RunCancelled):
        subagent.run(provider="faux", model="current", agent=_profile(), task="Lee datos",
                     tools=[{"name": "canvas_list"}], execute=execute, cancelled=lambda: token.cancelled)
    assert len(executed) == subagent.MAX_STEPS
