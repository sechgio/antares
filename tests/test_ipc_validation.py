"""Tests for IPC input validation."""

import io

import pytest

from backend import ipc_protocol
from backend.core.exceptions import InvalidRequestError
from backend.ipc_protocol import IPCMessage


def test_invalid_method() -> None:
    """Test that invalid methods are rejected."""
    with pytest.raises(InvalidRequestError):
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


class _BoundedBinaryStdin:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.readline_sizes: list[int] = []
        self.read_sizes: list[int] = []

    @property
    def buffer(self):
        return self

    def readline(self, size: int = -1) -> bytes:
        if size < 0:
            raise AssertionError("readline must receive a hard limit")
        self.readline_sizes.append(size)
        newline = self.data.find(b"\n")
        end = len(self.data) if newline < 0 else newline + 1
        amount = min(size, end)
        chunk = self.data[:amount]
        self.data = self.data[amount:]
        return chunk

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            raise AssertionError("read must receive a bounded size")
        self.read_sizes.append(size)
        chunk = self.data[:size]
        self.data = self.data[size:]
        return chunk


def test_oversized_binary_line_is_bounded_and_preserves_next_message(monkeypatch) -> None:
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", 1024)
    oversized = (
        b'{"jsonrpc":"2.0","id":"too-large","method":"version","params":{"data":"'
        + b"x" * 2_000
        + b'"}}\n'
    )
    valid = b'{"jsonrpc":"2.0","id":"after","method":"version","params":{}}\n'
    stdin = _BoundedBinaryStdin(oversized + valid)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    first = ipc_protocol.read_message()
    second = ipc_protocol.read_message()

    assert first is ipc_protocol._SKIP
    response = stdout.getvalue()
    assert '"id": "too-large"' in response
    assert '"code": -32600' in response
    assert isinstance(second, IPCMessage)
    assert second.id == "after"
    assert second.method == "version"
    assert stdin.readline_sizes
    assert all(0 < size <= 1025 for size in stdin.readline_sizes)


def test_inbound_payload_over_max_is_skipped(monkeypatch) -> None:
    """Oversized stdin lines without a parseable id must not be json.loads'd."""
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", 64)
    big = "x" * 200 + "\n"
    stdin = io.StringIO(big)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    result = ipc_protocol.read_message()

    assert result is ipc_protocol._SKIP
    assert stdout.getvalue() == ""


def test_inbound_payload_under_max_still_parses(monkeypatch) -> None:
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", 10_000)
    stdin = io.StringIO('{"jsonrpc":"2.0","id":"1","method":"version","params":{}}\n')
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    result = ipc_protocol.read_message()

    assert isinstance(result, IPCMessage)
    assert result.method == "version"


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
    assert '"code": -32600' in out
    assert '"category": "INVALID_REQUEST"' in out
    assert '"error"' in out


def test_invalid_params_with_known_id_sends_structured_error(monkeypatch) -> None:
    """Path-traversal params with a known id get a structured -32602 response."""
    stdin = io.StringIO('{"jsonrpc":"2.0","id":"p1","method":"version","params":{"path":"../../etc/passwd"}}\n')
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    result = ipc_protocol.read_message()

    assert result is ipc_protocol._SKIP
    out = stdout.getvalue()
    assert '"id": "p1"' in out
    assert '"code": -32602' in out
    assert '"category": "VALIDATION_ERROR"' in out
