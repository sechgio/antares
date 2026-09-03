
import io
import json

import pytest

from backend import ipc_protocol
from backend.core.exceptions import InvalidRequestError
from backend.ipc_protocol import IPCMessage


class _BinaryStdout:

    def __init__(self) -> None:
        self.buffer = io.BytesIO()

    def write(self, _data: str) -> int:  # pragma: no cover - must not be used
        raise AssertionError("text write path must not be used when buffer exists")

    def flush(self) -> None:
        return None


class _TextOnlyStdout:

    def __init__(self) -> None:
        self._buf = io.StringIO()

    def write(self, data: str) -> int:
        return self._buf.write(data)

    def flush(self) -> None:
        self._buf.flush()

    def getvalue(self) -> str:
        return self._buf.getvalue()


def test_invalid_method() -> None:
    with pytest.raises(InvalidRequestError):
        IPCMessage({"id": "1", "method": "../../../etc/passwd", "params": {}})

def test_missing_required_params() -> None:
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
    from backend.ipc_protocol import validate_params
    bad_params = {"path": "../../../etc/passwd"}
    assert not validate_params(bad_params), "Should reject path traversal"


def test_path_traversal_camelcase_key() -> None:
    from backend.ipc_protocol import validate_params
    assert not validate_params({"excelPath": "../../etc/passwd"}), "excelPath traversal must be rejected"
    assert not validate_params({"outputDir": "..\\..\\windows"}), "outputDir traversal must be rejected"
    assert validate_params({"excelPath": "C:/safe/data.xlsx"}), "safe excelPath must pass"
    assert validate_params({"outputDir": "C:/safe/out"}), "safe outputDir must pass"


def test_path_traversal_dict_value() -> None:
    from backend.ipc_protocol import validate_params
    assert not validate_params({"image_paths": {"logo": "../../etc/passwd"}}), "dict path traversal must be rejected"
    assert validate_params({"image_paths": {"logo": "C:/safe/img.png"}}), "safe dict paths must pass"
    assert validate_params({"image_paths": {"logo": None}}), "None dict entries must pass"


def test_parse_errors_skip_without_orphan_response(monkeypatch) -> None:
    stdin = io.StringIO("{not-json}\n")
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    result = ipc_protocol.read_message()

    assert result is ipc_protocol._SKIP
    assert stdout.getvalue() == ""


class _FragmentedTextStdin:
    def __init__(self, data: str, fragment_size: int = 3) -> None:
        self.data = data
        self.fragment_size = fragment_size
        self.readline_sizes: list[int] = []

    def readline(self, size: int = -1) -> str:
        if size < 0:
            raise AssertionError("readline must receive a bounded size")
        self.readline_sizes.append(size)
        newline = self.data.find("\n")
        end = len(self.data) if newline < 0 else newline + 1
        amount = min(size, self.fragment_size, end)
        chunk = self.data[:amount]
        self.data = self.data[amount:]
        return chunk


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


def test_fragmented_text_stream_parses_utf8_and_preserves_next_message(monkeypatch) -> None:
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", 1024)
    first = '{"jsonrpc":"2.0","id":"utf8","method":"version","params":{"label":"café"}}\n'
    second = '{"jsonrpc":"2.0","id":"after-text","method":"version","params":{}}\n'
    stdin = _FragmentedTextStdin(first + second)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    first_message = ipc_protocol.read_message()
    second_message = ipc_protocol.read_message()

    assert isinstance(first_message, IPCMessage)
    assert first_message.id == "utf8"
    assert isinstance(second_message, IPCMessage)
    assert second_message.id == "after-text"
    assert stdin.readline_sizes
    assert all(size > 0 for size in stdin.readline_sizes)


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


def test_oversized_binary_prefix_cut_mid_multibyte_still_answers(monkeypatch) -> None:
    max_size = 1024
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", max_size)

    base = b'{"jsonrpc":"2.0","id":"multibyte-cut","method":"version","params":{"data":"'
    pad = b"a" * (max_size - len(base))
    oversized = base + pad + "€".encode() + b'x"}}\n'
    valid = b'{"jsonrpc":"2.0","id":"after-mb","method":"version","params":{}}\n'
    stdin = _BoundedBinaryStdin(oversized + valid)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    first = ipc_protocol.read_message()
    second = ipc_protocol.read_message()

    assert first is ipc_protocol._SKIP
    response = stdout.getvalue()
    assert '"id": "multibyte-cut"' in response
    assert '"code": -32600' in response
    assert isinstance(second, IPCMessage)
    assert second.id == "after-mb"
    assert second.method == "version"


def test_payload_exactly_at_limit_is_accepted(monkeypatch) -> None:
    request = '{"jsonrpc":"2.0","id":"exact","method":"version","params":{}}\n'
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", len(request.encode("utf-8")))
    stdin = io.StringIO(request)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    result = ipc_protocol.read_message()

    assert isinstance(result, IPCMessage)
    assert result.id == "exact"


def test_multibyte_payload_is_limited_in_utf8_bytes(monkeypatch) -> None:
    request = '{"jsonrpc":"2.0","id":"utf8-limit","method":"version","params":{"label":"€€","data":"' + "x" * 220 + '"}}\n'
    request_size = len(request.encode("utf-8"))
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", 256)
    assert request_size > ipc_protocol._MAX_PAYLOAD_SIZE
    stdin = io.StringIO(request)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    result = ipc_protocol.read_message()

    assert result is ipc_protocol._SKIP
    assert '"id": "utf8-limit"' in stdout.getvalue()
    assert '"code": -32600' in stdout.getvalue()
    assert "bytes" in stdout.getvalue()


def test_oversized_text_line_without_id_does_not_write_orphan_response(monkeypatch) -> None:
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", 32)
    stdin = _FragmentedTextStdin("x" * 100, fragment_size=5)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    result = ipc_protocol.read_message()

    assert result is ipc_protocol._SKIP
    assert stdout.getvalue() == ""


def test_oversized_line_at_eof_is_skipped(monkeypatch) -> None:
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", 256)
    stdin = _FragmentedTextStdin('{"jsonrpc":"2.0","id":"eof","data":"' + "x" * 300, fragment_size=5)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", stdin)
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    result = ipc_protocol.read_message()
    end = ipc_protocol.read_message()

    assert result is ipc_protocol._SKIP
    assert end is None
    assert '"id": "eof"' in stdout.getvalue()
    assert '"code": -32600' in stdout.getvalue()


def test_inbound_payload_over_max_is_skipped(monkeypatch) -> None:
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


class _CountingByteStdout:

    def __init__(self) -> None:
        self.buffer = io.BytesIO()
        self.buffer_write_count = 0
        self.text_write_count = 0
        original_write = self.buffer.write

        def counting_write(data: bytes) -> int:
            self.buffer_write_count += 1
            return original_write(data)

        self.buffer.write = counting_write  # type: ignore[method-assign]

    def write(self, _data: str) -> int:
        self.text_write_count += 1
        raise AssertionError("send_* must write UTF-8 bytes via stdout.buffer")

    def flush(self) -> None:
        return None


def test_send_response_encodes_once_and_writes_bytes(monkeypatch) -> None:
    stdout = _CountingByteStdout()
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    ipc_protocol.send_response({"ok": True, "label": "café"}, "r1")

    assert stdout.text_write_count == 0
    assert stdout.buffer_write_count == 1
    line = stdout.buffer.getvalue()
    assert line.endswith(b"\n")
    payload = json.loads(line.decode("utf-8"))
    assert payload["id"] == "r1"
    assert payload["result"]["label"] == "café"


def test_send_response_writes_utf8_json_line_via_binary_buffer(monkeypatch) -> None:
    stdout = _BinaryStdout()
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    ipc_protocol.send_response({"ok": True, "label": "café"}, "r1")

    raw = stdout.buffer.getvalue()
    assert raw.endswith(b"\n")
    msg = json.loads(raw.decode("utf-8"))
    assert msg["jsonrpc"] == "2.0"
    assert msg["id"] == "r1"
    assert msg["result"]["label"] == "café"


def test_send_response_rejects_oversized_payload_with_utf8_byte_size(monkeypatch) -> None:
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", 64)
    stdout = _CountingByteStdout()
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    ipc_protocol.send_response({"data": "x" * 200}, "big")

    line = stdout.buffer.getvalue().decode("utf-8")
    payload = json.loads(line)
    assert payload["id"] == "big"
    assert payload["error"]["code"] == -32001
    assert "bytes" in payload["error"]["message"]
    assert "200" not in payload["error"]["message"] or "Response too large" in payload["error"]["message"]
    oversized_json = json.dumps(
        {"jsonrpc": "2.0", "id": "big", "result": {"data": "x" * 200}},
        ensure_ascii=False,
    )
    assert str(len(oversized_json.encode("utf-8"))) in payload["error"]["message"]


def test_send_notification_drops_oversized_without_writing(monkeypatch) -> None:
    monkeypatch.setattr(ipc_protocol, "_MAX_PAYLOAD_SIZE", 32)
    stdout = _CountingByteStdout()
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    ipc_protocol.send_notification("progress", {"chunk": "y" * 200})

    assert stdout.buffer_write_count == 0
    assert stdout.buffer.getvalue() == b""


def test_send_notification_writes_utf8_json_line_via_binary_buffer(monkeypatch) -> None:
    stdout = _BinaryStdout()
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    ipc_protocol.send_notification("ready", {"status": "ok"})

    raw = stdout.buffer.getvalue()
    assert raw.endswith(b"\n")
    msg = json.loads(raw.decode("utf-8"))
    assert msg["method"] == "ready"
    assert msg["params"]["status"] == "ok"
    assert "id" not in msg


def test_send_response_text_fallback_without_buffer(monkeypatch) -> None:
    stdout = _TextOnlyStdout()
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    ipc_protocol.send_response({"n": 1}, "t1")

    out = stdout.getvalue()
    assert out.endswith("\n")
    msg = json.loads(out)
    assert msg["id"] == "t1"
    assert msg["result"] == {"n": 1}


def test_send_notification_text_fallback_without_buffer(monkeypatch) -> None:
    stdout = _TextOnlyStdout()
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    ipc_protocol.send_notification("backend.shutdown", {"reason": "signal"})

    msg = json.loads(stdout.getvalue())
    assert msg["method"] == "backend.shutdown"
    assert msg["params"]["reason"] == "signal"
