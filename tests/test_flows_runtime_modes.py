# Regressions for packaged flow execution and mutex handoff.

import io
import json

from backend import main as backend_main
from backend.core.flows import code_exec


def test_gui_backend_claims_gui_mutex_before_waiting_for_headless(monkeypatch):
    events = []

    def hold(name, timeout_ms):
        events.append(("hold", name, timeout_ms))
        return True

    monkeypatch.setattr(backend_main, "_hold_mutex", hold)
    monkeypatch.setattr(backend_main, "_release_mutex", lambda name: events.append(("release", name)))

    backend_main._claim_gui_mutex()

    assert events == [
        ("hold", backend_main._GUI_MUTEX, 0),
        ("hold", backend_main._HEADLESS_MUTEX, backend_main._MUTEX_WAIT_INFINITE),
        ("release", backend_main._HEADLESS_MUTEX),
    ]


def test_headless_rechecks_gui_mutex_after_acquiring_headless(monkeypatch):
    checks = iter([False, True])
    released = []
    init_db = []
    monkeypatch.setattr(backend_main, "_mutex_held", lambda _name: next(checks))
    monkeypatch.setattr(backend_main, "_hold_mutex", lambda _name, _timeout: True)
    monkeypatch.setattr(backend_main, "_release_mutex", released.append)
    monkeypatch.setattr(backend_main, "init_db", lambda: init_db.append(True))

    assert backend_main._headless_flow_run("flow-1") == 0
    assert init_db == []
    assert released == [backend_main._HEADLESS_MUTEX]


def test_frozen_code_node_spawns_the_packaged_backend_mode(monkeypatch):
    commands = []

    class Child:
        returncode = 0

        def communicate(self, payload):
            self.payload = json.loads(payload)
            return b'{"ok":true,"result":42}', b""

        def kill(self):
            pass

    child = Child()

    def popen(command, **_kwargs):
        commands.append(command)
        return child

    monkeypatch.setattr(code_exec.sys, "frozen", True, raising=False)
    monkeypatch.setattr(code_exec.subprocess, "Popen", popen)

    assert code_exec.run_python("result = 42", {"code": "result = 42"}, 1, None) == {"json": 42}
    assert commands == [[code_exec.sys.executable, "--flow-code-run"]]
    assert child.payload["code"] == "result = 42"


def test_packaged_code_child_writes_one_json_result(monkeypatch):
    class Input:
        buffer = io.BytesIO(b'{"code":"result = item * 2","item":21}')

    output = io.StringIO()
    monkeypatch.setattr(code_exec.sys, "stdin", Input())
    monkeypatch.setattr(code_exec.sys, "stdout", output)

    assert code_exec.run_code_child() == 0
    assert json.loads(output.getvalue()) == {"ok": True, "result": 42}
