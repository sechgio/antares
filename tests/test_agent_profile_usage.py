import json
import threading
import time
from datetime import date

from backend.core.agent import agent, agent_chat
from backend.handlers import agent_internal


def test_cancelled_subagent_keeps_usage_without_delaying_stop_or_counting_replay(tmp_path, monkeypatch):
    store = agent.AgentStore(tmp_path)
    session = store.create_session("faux", "faux-1", "Padre")
    runner = agent.AgentRunner(store, lambda name: None)
    monkeypatch.setattr(agent, "get_agent_store", lambda: store)
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    started, release = threading.Event(), threading.Event()
    calls = []

    def chat(*args, **kwargs):
        calls.append(True)
        started.set()
        assert release.wait(5)
        return {"text": "Respuesta cancelada", "calls": [], "usage": {"input": 8, "output": 3}}

    monkeypatch.setattr(agent_chat, "chat", chat)
    request = {"session_id": session["id"], "call_id": "c1", "name": "subagent_run", "params": {"task": "Revisa"},
               "context": {"subagent": {"id": "hijo", "name": "Hijo", "tools": [], "remaining_tokens": 1000}}}
    agent_internal._dispatch(request)
    try:
        assert started.wait(5)
        assert agent_internal._dispatch_cancel({"session_id": session["id"], "call_id": "c1"})["cancelled"]
    finally:
        release.set()
    deadline = time.monotonic() + 5
    result = None
    while time.monotonic() < deadline:
        result = agent_internal._dispatch_result({"session_id": session["id"], "call_id": "c1"})
        if result["dispatch"]["status"] != "running":
            break
        time.sleep(0.01)
    assert result["dispatch"]["status"] == "uncertain"
    assert "error" in json.loads(result["result"])
    assert "Respuesta cancelada" not in result["result"]
    params = {"profile_id": "hijo", "day": date.today().isoformat()}
    assert agent_internal.HANDLERS["agent_internal_profile_usage"](params) == {"tokens": 11}
    assert agent_internal._dispatch(request)["dispatch"]["status"] == "uncertain"
    assert calls == [True]
    restored = agent.AgentStore(tmp_path)
    monkeypatch.setattr(agent, "get_agent_store", lambda: restored)
    assert agent_internal.HANDLERS["agent_internal_profile_usage"](params) == {"tokens": 11}
    assert agent_internal.HANDLERS["agent_internal_profile_usage"]({**params, "profile_id": "otro"}) == {"tokens": 0}
    assert agent_internal.HANDLERS["agent_internal_profile_usage"]({**params, "day": "2000-01-01"}) == {"tokens": 0}
