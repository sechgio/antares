from __future__ import annotations

import base64
import json
import time
from io import BytesIO
from pathlib import Path

import pymupdf
import pytest

from backend.core.agent import agent, agent_tools, artifacts, documents, resource_grants


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


@pytest.mark.parametrize(("format_name", "mime"), [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")])
def test_images_tool_copies_validated_files_and_survives_restart(tmp_path, format_name, mime):
    from PIL import Image

    store = agent.AgentStore(tmp_path / "agent")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "grafico.bin"
    Image.new("RGB", (1800, 900), "white").save(source, format=format_name)
    grant = resource_grants.folder_record(str(workspace), None)
    store.add_grants("s1", [{**grant, "active": True}])
    result = agent_tools.run("images_show", {"images": [{"path": source.name, "title": "Metrado diario"}]}, store, "s1")
    artifact = result["artifact"]
    file = artifact["files"][0]
    target = Path(file["path"])
    assert artifact["kind"] == "image" and file["mime"] == mime
    assert file["title"] == "Metrado diario" and (file["width"], file["height"]) == (1800, 900)
    assert target.parent == store.drafts_dir("s1") and target.read_bytes() == source.read_bytes()
    source.unlink()
    store.revoke_grants("s1")
    reopened = agent.AgentStore(tmp_path / "agent")
    assert reopened.artifacts_for("s1")[0]["id"] == artifact["id"]
    params = {"artifact_id": artifact["id"], "file_index": 0, "sha256": file["sha256"], "action": "preview"}
    for full_size, expected in [(False, (360, 180)), (True, (1800, 900))]:
        preview = artifacts.action(reopened, "s1", {**params, "full_size": full_size})
        with Image.open(BytesIO(base64.b64decode(preview["png_base64"]))) as image:
            assert image.size == expected
        assert preview["sha256"] == file["sha256"] and "pages" not in preview
    saved = artifacts.action(reopened, "s1", {**params, "action": "file"})
    assert saved["mime"] == mime and saved["name"] == file["name"]
    with pytest.raises(ValueError, match="conversación"):
        artifacts.action(reopened, "s2", params)
    with pytest.raises(ValueError, match="PDF"):
        artifacts.action(reopened, "s1", {**params, "action": "review"})
    with pytest.raises(ValueError, match="PDF"):
        artifacts.validate_print(reopened, "s1", params)
    with pytest.raises(ValueError, match="PDF"):
        artifacts.print_artifact(reopened, "s1", params, "op")
    target.write_bytes(target.read_bytes() + b"changed")
    with pytest.raises(ValueError, match="cambió"):
        artifacts.action(reopened, "s1", params)


def test_images_are_bounded_and_failed_batches_leave_no_artifacts(tmp_path, monkeypatch):
    from PIL import Image

    store = agent.AgentStore(tmp_path / "agent")
    root = store.drafts_dir("s1")
    root.mkdir(parents=True)
    source = root / "grafico.png"
    Image.new("RGB", (100, 100)).save(source)
    valid = {"path": str(source)}
    for images in [[], [valid] * 9, [None], [{**valid, "title": "x" * 201}]]:
        with pytest.raises(ValueError):
            artifacts.show_images(store, "s1", {"images": images})
    external = tmp_path / "secreto.png"
    external.write_bytes(source.read_bytes())
    for value in [str(external), "../secreto.png", "https://example.com/a.png"]:
        with pytest.raises(ValueError):
            artifacts.show_images(store, "s1", {"images": [valid, {"path": value}]})
        assert list(root.iterdir()) == [source] and store.artifacts_for("s1") == []
    invalid = root / "corrupto.png"
    invalid.write_bytes(b"not a PNG")
    with pytest.raises(ValueError, match="válida"):
        artifacts.show_images(store, "s1", {"images": [valid, {"path": str(invalid)}]})
    gif = root / "animacion.gif"
    Image.new("RGB", (10, 10)).save(gif)
    with pytest.raises(ValueError, match="PNG"):
        artifacts.show_images(store, "s1", {"images": [{"path": str(gif)}]})
    monkeypatch.setattr(artifacts, "_MAX_IMAGE_PIXELS", 99)
    with pytest.raises(ValueError, match="megapíxeles"):
        artifacts.show_images(store, "s1", {"images": [valid]})
    monkeypatch.setattr(artifacts, "_MAX_IMAGE_BYTES", 1)
    with pytest.raises(ValueError, match="25 MiB"):
        artifacts.show_images(store, "s1", {"images": [valid]})
    assert not store.artifacts_for("s1")


def test_images_reject_symlinks(tmp_path):
    from PIL import Image

    store = agent.AgentStore(tmp_path / "agent")
    root = store.drafts_dir("s1")
    root.mkdir(parents=True)
    source = root / "grafico.png"
    Image.new("RGB", (20, 20)).save(source)
    link = root / "enlace.png"
    try:
        link.symlink_to(source)
    except OSError:
        pytest.skip("Windows no permite crear enlaces simbólicos en este entorno")
    with pytest.raises(ValueError, match=r"enlaces|reparse"):
        artifacts.show_images(store, "s1", {"images": [{"path": str(link)}]})


def test_images_dispatch_returns_the_chat_artifact_and_replays_without_duplicates(tmp_path, monkeypatch):
    from PIL import Image

    from backend.handlers import agent_internal

    store = agent.AgentStore(tmp_path / "agent")
    runner = agent.AgentRunner(store, lambda _: None)
    monkeypatch.setattr(agent, "get_agent_store", lambda: store)
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    source = store.drafts_dir("s1") / "metrado.png"
    source.parent.mkdir(parents=True)
    Image.new("RGB", (640, 320)).save(source)
    call = {"session_id": "s1", "call_id": "show-chart", "name": "images_show",
            "params": {"images": [{"path": str(source), "title": "Metrado por día"}]}}
    dispatch = agent_internal.HANDLERS["agent_internal_dispatch"]
    out = dispatch(call)
    deadline = time.monotonic() + 10
    while out["result"] is None and time.monotonic() < deadline:
        time.sleep(0.02)
        out = agent_internal.HANDLERS["agent_internal_dispatch_result"]({"session_id": "s1", "call_id": "show-chart"})
    artifact = json.loads(out["result"])["artifact"]
    assert out["dispatch"]["status"] == "succeeded" and artifact["kind"] == "image"
    assert not store.pending_approvals("s1")
    response = agent_internal.HANDLERS["agent_internal_artifacts"]({"session_id": "s1"})
    assert [item["id"] for item in response["artifacts"]] == [artifact["id"]]
    assert json.loads(dispatch(call)["result"])["artifact"]["id"] == artifact["id"]
    reopened = agent.AgentStore(tmp_path / "agent")
    assert len(reopened.artifacts_for("s1")) == 1 and reopened.artifacts_for("other") == []
    preview = artifacts.action(reopened, "s1", {"artifact_id": artifact["id"], "file_index": 0,
                               "sha256": artifact["files"][0]["sha256"], "action": "preview"})
    assert preview["png_base64"]


def test_image_preview_checks_the_exact_bytes_it_renders(tmp_path, monkeypatch):
    from PIL import Image

    store = agent.AgentStore(tmp_path)
    source = store.drafts_dir("s1") / "chart.png"
    source.parent.mkdir(parents=True)
    Image.new("RGB", (50, 50), "blue").save(source)
    artifact = artifacts.show_images(store, "s1", {"images": [{"path": str(source)}]})["artifact"]
    verified = artifacts.verified_file

    def replace_after_verification(*args):
        result = verified(*args)
        Image.new("RGB", (50, 50), "red").save(result[2])
        return result

    monkeypatch.setattr(artifacts, "verified_file", replace_after_verification)
    with pytest.raises(ValueError, match="cambió"):
        artifacts.action(store, "s1", {"artifact_id": artifact["id"], "file_index": 0, "action": "preview"})
