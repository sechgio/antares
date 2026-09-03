
from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path

import pytest

from backend import ipc_protocol
from backend import main as backend_main
from backend.core.exceptions import ValidationError
from backend.core.sellador_io import MAX_PDF_BYTES, read_user_file, resolve_stamp_bytes
from backend.handlers.history import history_list
from backend.handlers.sellador import _estimate_b64_decoded_size, sellador_apply, sellador_inspect_pdf
from backend.utils.html_sanitizer import sanitize_html_for_pdf


def test_read_user_file_rejects_oversized_pdf(tmp_path: Path) -> None:
    pdf_path = tmp_path / "big.pdf"
    pdf_path.write_bytes(b"%PDF" + b"x" * (MAX_PDF_BYTES + 1))
    with pytest.raises(ValueError, match="demasiado grande"):
        read_user_file(str(pdf_path), "PDF", max_bytes=MAX_PDF_BYTES)


def test_read_user_file_rejects_symlink_before_resolve(tmp_path: Path) -> None:
    target = tmp_path / "secret.pdf"
    target.write_bytes(b"%PDF secret")
    link = tmp_path / "link.pdf"
    try:
        os.symlink(target, link)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks no disponibles en este entorno (Windows sin developer mode)")
    with pytest.raises(ValueError, match="symlink"):
        read_user_file(str(link), "PDF", max_bytes=MAX_PDF_BYTES)


def test_read_user_file_rejects_symlink_in_parent(tmp_path: Path) -> None:
    real_dir = tmp_path / "real"
    real_dir.mkdir()
    (real_dir / "doc.pdf").write_bytes(b"%PDF doc")
    link_dir = tmp_path / "linkdir"
    try:
        os.symlink(real_dir, link_dir, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks no disponibles en este entorno (Windows sin developer mode)")
    with pytest.raises(ValueError, match="symlink"):
        read_user_file(str(link_dir / "doc.pdf"), "PDF", max_bytes=MAX_PDF_BYTES)


def test_resolve_stamp_bytes_falls_back_to_b64_when_path_missing(tmp_path: Path) -> None:
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    missing = tmp_path / "gone.png"
    raw = base64.b64encode(png).decode("ascii")
    out = resolve_stamp_bytes({"stamp_path": str(missing), "stamp_b64": raw})
    assert out == png


def test_estimate_b64_size_accounts_for_padding() -> None:
    raw = base64.b64encode(b"x" * (10 * 1024 * 1024)).decode("ascii")

    assert _estimate_b64_decoded_size(raw) == 10 * 1024 * 1024


def test_sellador_apply_rejects_oversized_base64() -> None:
    huge = base64.b64encode(b"x" * (MAX_PDF_BYTES + 1)).decode("ascii")
    stamp = base64.b64encode(b"stamp").decode("ascii")
    with pytest.raises(ValueError, match="PDF demasiado grande"):
        sellador_apply({
            "pdf_b64": huge,
            "stamp_b64": stamp,
            "stamp_count": 1,
            "x": 1,
            "y": 1,
            "width": 10,
            "height": 10,
        })


def test_sanitize_strips_unsafe_data_uri_in_src() -> None:
    html = '<img src="data:text/html,<script>alert(1)</script>"/>'
    out = sanitize_html_for_pdf(html)
    assert "data:text/html" not in out
    assert 'src=""' in out or "src=''" in out


def test_sanitize_keeps_safe_image_data_uri_in_src() -> None:
    html = '<img src="data:image/png;base64,AAAA"/>'
    out = sanitize_html_for_pdf(html)
    assert "data:image/png;base64,AAAA" in out


def test_sellador_inspect_pdf_rejects_path_traversal() -> None:
    with pytest.raises(ValueError, match="Path traversal"):
        sellador_inspect_pdf({"pdf_path": "../../etc/passwd"})


def test_history_list_caps_limit() -> None:
    with pytest.raises(ValueError, match="limit"):
        history_list({"limit": 1000})


def test_history_list_rejects_negative_offset() -> None:
    with pytest.raises(ValueError, match="offset"):
        history_list({"offset": -1})


def test_inbound_payload_over_max_with_id_sends_error(monkeypatch) -> None:
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", 64)
    payload = {"jsonrpc": "2.0", "id": "req-big", "method": "version", "params": {"blob": "x" * 200}}
    line = json.dumps(payload) + "\n"
    stdin = io.StringIO(line)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    result = ipc_protocol.read_message()

    assert result is ipc_protocol._SKIP
    out = stdout.getvalue()
    assert '"id": "req-big"' in out
    assert '"error"' in out
    assert "too large" in out.lower()


def test_dispatch_prefers_user_facing_value_error(monkeypatch) -> None:
    sent: list[dict] = []
    monkeypatch.setattr(backend_main, "send_response", lambda *args, **kwargs: sent.append({"args": args, **kwargs}))

    def boom(_params):
        raise ValueError("Parámetro inválido")

    backend_main._dispatch(boom, {}, "42", "test_method")
    assert sent
    assert sent[0]["error"] == "Parámetro inválido"


def test_dispatch_structured_exception(monkeypatch) -> None:
    sent: list[dict] = []
    monkeypatch.setattr(backend_main, "send_response", lambda *args, **kwargs: sent.append({"args": args, **kwargs}))

    def boom(_params):
        raise ValidationError("Ruta no permitida")

    backend_main._dispatch(boom, {}, "99", "test_method")
    assert sent
    err = sent[0]["error"]
    assert hasattr(err, "to_dict")
    assert err.to_dict()["message"] == "Ruta no permitida"
