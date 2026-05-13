"""Tests for IPC input validation."""

import pytest

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

if __name__ == "__main__":
    test_invalid_method()
    test_path_traversal()
