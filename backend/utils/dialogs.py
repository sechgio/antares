"""Native dialog handling without tkinter - uses IPC notifications instead."""

from __future__ import annotations

from typing import Any

from backend.ipc_protocol import send_notification


def request_dialog(dialog_type: str, title: str, **kwargs) -> dict[str, Any]:
    """Request a dialog from the frontend via IPC notification.

    NOTE: This is asynchronous - actual result comes via separate IPC call.
    The frontend should listen for 'dialog.request' and show the appropriate dialog.
    """
    send_notification("dialog.request", {
        "type": dialog_type,
        "title": title,
        **kwargs
    })

    # Return empty - actual result should come via a separate IPC call
    return {"paths": []}
