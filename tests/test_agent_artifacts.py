from __future__ import annotations

import base64
import json
from pathlib import Path

import pymupdf
import pytest

from backend.core.agent import agent, artifacts, documents


@pytest.fixture()
def sample(tmp_path):
    store = agent.AgentStore(tmp_path / "agent")
    root = store.drafts_dir("s1")
    root.mkdir(parents=True)
    path = root / "sample.pdf"
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((40, 40), "PDF revisado")
        pdf.save(path)
    artifact = store.add_artifact("s1", documents.native_artifact({"saved_path": str(path)}, root, "a1"))
    params = {"artifact_id": artifact["id"], "file_index": 0, "sha256": artifact["files"][0]["sha256"]}
    return store, path, params


def test_preview_review_and_hash_substitution(sample):
    store, path, params = sample
    result = artifacts.action(store, "s1", {**params, "action": "preview"})
    assert result["pages"] == 1 and result["png_base64"]
    artifacts.action(store, "s1", {**params, "action": "review"})
    assert store.artifacts_for("s1")[0]["reviewed"]["0"] == params["sha256"]
    with pytest.raises(ValueError, match="conversación"):
        artifacts.verified_file(store, "s2", params)
    path.write_bytes(path.read_bytes() + b"changed")
    with pytest.raises(ValueError, match="cambió"):
        artifacts.action(store, "s1", {**params, "action": "preview"})


def test_print_requires_review_and_uses_an_immutable_copy(sample, monkeypatch):
    store, path, params = sample
    with pytest.raises(ValueError, match="Revisa"):
        artifacts.print_artifact(store, "s1", {**params, "printer_name": "Test"}, "op1")
    artifacts.action(store, "s1", {**params, "action": "review"})
    outcome, claim = store.dispatch_claim("s1", "c1", "artifact_print", params, None)
    assert outcome == "new"
    copies = []

    def fake_print(source, printer, count, **options):
        copies.append(source)
        assert source != str(path)
        assert options["job_name"] == f"Antares-{claim['op_id']}"
        options["on_submitted"](42)
        return {"queued": True, "job_id": 42}

    monkeypatch.setattr("backend.core.printing.print_pdf", fake_print)
    result = artifacts.print_artifact(store, "s1", {**params, "printer_name": "Test"}, claim["op_id"])
    assert result["queued"] and result["sha256"] == params["sha256"]
    assert store.get_dispatch("s1", "c1")["job_id"] == 42
    assert not Path(copies[0]).exists()


@pytest.mark.parametrize("submitted", [True, False])
def test_crash_after_spooler_submission_does_not_print_again(sample, monkeypatch, submitted):
    store, _, params = sample
    _, claim = store.dispatch_claim("s1", "c1", "artifact_print", params, None)
    store.dispatch_note("s1", claim["op_id"], {"job_id": 42, "printer_name": "Test"})
    monkeypatch.setattr("backend.core.printing.printer_job_status", lambda *args: {"submitted": submitted, "uncertain": not submitted, "job_id": 42})
    reopened = agent.AgentStore(store._dispatches_path.parent)
    outcome, receipt = reopened.dispatch_claim("s1", "c1", "artifact_print", params, None)
    assert outcome == "existing" and receipt["status"] == ("submitted" if submitted else "uncertain")
    assert json.loads(receipt["result"])["recovered"]


def test_full_receipt_and_question_isolation(tmp_path):
    store = agent.AgentStore(tmp_path)
    _, claim = store.dispatch_claim("s1", "c1", "read", {}, None)
    content = json.dumps({"text": "x" * (agent._MAX_RECEIPT_CHARS + 1)})
    store.dispatch_finish("s1", "c1", claim["op_id"], "succeeded", content)
    receipt = store.get_dispatch("s1", "c1")
    assert json.loads(Path(receipt["result_ref"]).read_text(encoding="utf-8"))["result"] == content
    question = store.add_question("s1", "q1", {"questions": [{"id": "template", "prompt": "Elige plantilla", "options": ["A", "B"]}]})
    with pytest.raises(ValueError, match="conversación"):
        store.answer_question("s2", question["id"], {"template": "A"})
    store.answer_question("s1", question["id"], {"template": "A"})
    assert store.questions_for("s1") == []


def test_backend_pdf_is_registered_without_large_inline_payload(sample):
    store, path, _ = sample
    result = artifacts.backend_pdf(store, "s1", "sellador_apply", {"pdf_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
        "filename": "sellado.pdf", "stamp_count": 2}, "op2")
    assert "pdf_base64" not in result and result["stamp_count"] == 2
    file = result["artifact"]["files"][0]
    assert file["pages"] == 1 and file["sha256"] and result["artifact"]["module"] == "sellador"
    assert artifacts.backend_pdf(store, "s1", "mcp_foreign", {"saved_path": "C:/secret.pdf"}, "op3") == {"saved_path": "C:/secret.pdf"}
    with pytest.raises(ValueError, match="fuera"):
        artifacts.backend_pdf(store, "s1", "sellador_apply", {"saved_path": "C:/secret.pdf"}, "op3")


def test_print_options_are_validated_before_approval(sample, monkeypatch):
    store, _, params = sample
    monkeypatch.setattr("backend.core.printing.list_printers", lambda: [{"name": "Test"}])
    artifacts.validate_print(store, "s1", {**params, "printer_name": "Test", "pages": "1"})
    for invalid in [{"pages": "2"}, {"copies": 0}, {"duplex": "bad"}, {"quality": "bad"}, {"printer_name": "Gone"}]:
        with pytest.raises(ValueError):
            artifacts.validate_print(store, "s1", {**params, "printer_name": "Test", **invalid})


def test_failed_journal_after_startdoc_keeps_the_effect_uncertain(sample, monkeypatch):
    from backend.core.agent.cancel import RunCancelled

    store, _, params = sample
    artifacts.action(store, "s1", {**params, "action": "review"})
    monkeypatch.setattr(store, "dispatch_note", lambda *args: (_ for _ in ()).throw(OSError("Disco")))
    monkeypatch.setattr("backend.core.printing.print_pdf", lambda *args, **options: options["on_submitted"](42))
    with pytest.raises(RunCancelled):
        artifacts.print_artifact(store, "s1", {**params, "printer_name": "Test"}, "op1")


def test_attention_is_durable(tmp_path):
    store = agent.AgentStore(tmp_path)
    question = store.add_question("s1", "q1", {"questions": [{"id": "template", "prompt": "Elige"}]})
    assert store.attention() == {"s1": "waiting_input"}
    store.answer_question("s1", question["id"], {"template": "A"})
    approval = store.ensure_approval("s1", {"id": "c1", "name": "write", "params": {}})
    assert store.attention() == {"s1": "waiting_approval"}
    store.decide_approval(approval["id"], False)
    _, claim = store.dispatch_claim("s1", "c2", "write", {}, None)
    store.dispatch_finish("s1", "c2", claim["op_id"], "uncertain", '{}')
    assert store.attention() == {"s1": "uncertain"}
    assert agent.AgentStore(tmp_path).attention() == {"s1": "uncertain"}
