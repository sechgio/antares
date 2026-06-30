"""Tests for IPC handlers."""

from backend import handlers


class TestProcessStart:
    def setup_method(self) -> None:
        handlers._reset_state()

    def test_returns_false_and_logs_when_no_files(self) -> None:
        result = handlers.HANDLERS["process_start"]({"files": [], "destino": "out", "locale": "es"})

        assert result["started"] is False
        assert result["reason"] == "no_files"
        assert handlers._state.logs[0] == {
            "message": "No hay archivos para procesar",
            "tag": "error",
        }
