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
    """Test that missing required params are handled."""
    # This will be caught by the decorator later

def test_path_traversal() -> None:
    """Test path traversal detection."""
    from backend.ipc_protocol import validate_params
    bad_params = {"path": "../../../etc/passwd"}
    assert not validate_params(bad_params), "Should reject path traversal"


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
