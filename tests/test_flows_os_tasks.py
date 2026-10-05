"""Windows flow scheduling and mutex behavior."""

import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from subprocess import CompletedProcess

import pytest

from backend.core.flows import os_tasks


def _flow(interval):
    return {
        "id": "flow-1",
        "enabled": True,
        "graph": {"nodes": [{"kind": "trigger", "config": {
            "trigger_kind": "schedule", "interval_minutes": interval,
        }}]},
    }


def test_schedule_xml_preserves_large_minute_intervals(monkeypatch):
    monkeypatch.setenv("USERNAME", "antares-user")
    xml = ET.fromstring(os_tasks._task_xml("flow-1", 1500))
    ns = "{http://schemas.microsoft.com/windows/2004/02/mit/task}"
    interval = xml.find(f".//{ns}Repetition/{ns}Interval")

    assert interval is not None and interval.text == "PT1500M"
    assert xml.find(f".//{ns}Repetition/{ns}Duration") is None
    assert xml.find(f".//{ns}Principal/{ns}UserId").text == "antares-user"
    assert xml.find(f".//{ns}Exec/{ns}Arguments").text == "--flow-run flow-1"


def test_schedule_accepts_the_full_configured_range():
    assert os_tasks._schedule_trigger(_flow(1)) == {"interval_minutes": 1}
    assert os_tasks._schedule_trigger(_flow(10080)) == {"interval_minutes": 10080}
    assert os_tasks._schedule_trigger(_flow(10081)) is None


def test_task_registration_uses_xml_and_reports_schtasks_failure(monkeypatch):
    captured = {}

    def fail(*args):
        captured["args"] = args
        captured["xml"] = Path(args[-1]).read_bytes()
        return CompletedProcess(args, 1, stdout=b"", stderr=b"invalid task")

    errors = []
    monkeypatch.setattr(os_tasks, "_schtasks", fail)
    monkeypatch.setattr(os_tasks.logger, "error", lambda *args: errors.append(args))

    assert not os_tasks._register_flow_task("AntaresFlow-flow-1", "flow-1", 1440)
    assert captured["args"][:4] == ("/Create", "/F", "/TN", "AntaresFlow-flow-1")
    assert ET.fromstring(captured["xml"]).tag.endswith("Task")
    assert errors and "no pudo registrar" in errors[0][0]


@pytest.mark.skipif(sys.platform != "win32", reason="named mutexes are Windows-only")
def test_named_mutex_is_visible_across_processes():
    name = f"Local\\AntaresFlowsTest-{uuid.uuid4().hex}"
    handle = os_tasks.hold_mutex(name, 0)
    assert handle is not None
    query = (
        "from backend.core.flows.os_tasks import mutex_held; "
        "import sys; sys.exit(0 if mutex_held(sys.argv[1]) else 1)"
    )

    try:
        held = subprocess.run([sys.executable, "-c", query, name], capture_output=True, timeout=5)
        assert held.returncode == 0
    finally:
        os_tasks.release_mutex(handle)

    released = subprocess.run([sys.executable, "-c", query, name], capture_output=True, timeout=5)
    assert released.returncode == 1
