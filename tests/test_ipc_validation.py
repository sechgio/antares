"""Tests for IPC input validation."""

import io

import pytest

from backend import ipc_protocol
from backend.ipc_protocol import IPCMessage


def test_invalid_method() -> None:
    """Test that invalid methods are rejected."""
    with pytest.raises(ValueError):
        IPCMessage({"id": "1", "method": "../../../etc/passwd", "params": {}})

def test_missing_required_params() -> None:
    """Handler @validate_params rejects missing or null required keys."""
    from backend.handlers.common import validate_params as require_params

    @require_params("files")
    def handler(params: dict) -> str:
        return "ok"

    with pytest.raises(ValueError, match="Missing required parameter: files"):
        handler({})
    with pytest.raises(ValueError, match="Missing required parameter: files"):
        handler({"files": None})
    assert handler({"files": ["a.jpg"]}) == "ok"

def test_path_traversal() -> None:
    """Test path traversal detection."""
    from backend.ipc_protocol import validate_params
    bad_params = {"path": "../../../etc/passwd"}
    assert not validate_params(bad_params), "Should reject path traversal"


def test_path_traversal_camelcase_key() -> None:
    """Regression (B3): camelCase path keys like excelPath must be screened."""
    from backend.ipc_protocol import validate_params
    assert not validate_params({"excelPath": "../../etc/passwd"}), "excelPath traversal must be rejected"
    assert not validate_params({"outputDir": "..\\..\\windows"}), "outputDir traversal must be rejected"
    assert validate_params({"excelPath": "C:/safe/data.xlsx"}), "safe excelPath must pass"
    assert validate_params({"outputDir": "C:/safe/out"}), "safe outputDir must pass"


def test_path_traversal_dict_value() -> None:
    """Regression (B4): dict-of-paths (image_paths) must be screened per value."""
    from backend.ipc_protocol import validate_params
    assert not validate_params({"image_paths": {"logo": "../../etc/passwd"}}), "dict path traversal must be rejected"
    assert validate_params({"image_paths": {"logo": "C:/safe/img.png"}}), "safe dict paths must pass"
    # None entries in a path dict are tolerated (handlers filter them later).
    assert validate_params({"image_paths": {"logo": None}}), "None dict entries must pass"


def test_parse_errors_skip_without_orphan_response(monkeypatch) -> None:
    """A JSON parse error must NOT send an id=null response.

    Such a response cannot be correlated with any pending request on the
    frontend side and would just be discarded, causing the caller to
    block until its own timeout. Instead, parse errors are logged only.
    """
    stdin = io.StringIO("{not-json}\n")
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    result = ipc_protocol.read_message()

    assert result is ipc_protocol._SKIP
    # No orphan response with id=null should be written to stdout.
    assert stdout.getvalue() == ""


def test_invalid_message_with_known_id_sends_error(monkeypatch) -> None:
    """If the JSON parses but the message is invalid, an error response is
    sent using the original request id so the frontend can correlate it."""
    stdin = io.StringIO('{"jsonrpc":"2.0","id":"abc","method":"../../bad","params":{}}\n')
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    result = ipc_protocol.read_message()

    assert result is ipc_protocol._SKIP
    out = stdout.getvalue()
    assert '"id": "abc"' in out
    assert '"error"' in out

if __name__ == "__main__":
    test_invalid_method()
    test_path_traversal()
