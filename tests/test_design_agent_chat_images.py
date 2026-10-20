from __future__ import annotations

from typing import Any

from backend.core.agent import agent_chat

PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def test_openai_wire_turns_images_into_image_url_parts() -> None:
    wire = agent_chat._openai_wire(
        [{"role": "user", "content": "revisa estas", "images": [{"media_type": "image/png", "data_b64": PNG_1X1}]}],
        "system",
    )
    content = wire[1]["content"]
    assert isinstance(content, list)
    assert content[0] == {"type": "text", "text": "revisa estas"}
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_openai_wire_without_images_stays_a_plain_string() -> None:
    wire = agent_chat._openai_wire([{"role": "user", "content": "hola"}], "system")
    assert wire[1]["content"] == "hola"


def test_anthropic_wire_turns_images_into_base64_blocks() -> None:
    wire = agent_chat._anthropic_wire(
        [{"role": "user", "content": "revisa estas", "images": [{"media_type": "image/jpeg", "data_b64": PNG_1X1}]}]
    )
    blocks = wire[0]["content"]
    assert blocks[0] == {"type": "text", "text": "revisa estas"}
    assert blocks[1]["type"] == "image"
    assert blocks[1]["source"]["media_type"] == "image/jpeg"
    assert blocks[1]["source"]["data"] == PNG_1X1


def test_sanitize_images_drops_bad_media_types_and_empty_data() -> None:
    cleaned = agent_chat._sanitize_images(
        [
            {"media_type": "image/png", "data_b64": PNG_1X1},
            {"media_type": "application/x-sh", "data_b64": "AAAA"},
            {"media_type": "image/png", "data_b64": ""},
            {"media_type": "image/png"},
            "no soy un dict",
            None,
        ]
    )
    assert [c["media_type"] for c in cleaned] == ["image/png"]


def test_sanitize_images_caps_the_attachment_count() -> None:
    cleaned = agent_chat._sanitize_images(
        [{"media_type": "image/png", "data_b64": PNG_1X1}] * (agent_chat._MAX_IMAGES_PER_MESSAGE + 5)
    )
    assert len(cleaned) == agent_chat._MAX_IMAGES_PER_MESSAGE


def test_sanitize_images_rejects_an_oversized_payload() -> None:
    huge = "A" * (agent_chat._MAX_IMAGE_B64_CHARS + 1)
    assert agent_chat._sanitize_images([{"media_type": "image/png", "data_b64": huge}]) == []


def test_sanitize_images_handles_absent_or_non_list() -> None:
    assert agent_chat._sanitize_images(None) == []
    assert agent_chat._sanitize_images({"media_type": "image/png"}) == []


def test_wire_functions_keep_history_intact_with_images() -> None:
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": "haz un deck", "images": [{"media_type": "image/png", "data_b64": PNG_1X1}]},
        {
            "role": "assistant",
            "content": "uso la herramienta",
            "tool_calls": [{"id": "c1", "name": "create_design", "params": {}}],
        },
        {"role": "tool_result", "tool_use_id": "c1", "name": "create_design", "content": '{"ok":true}'},
    ]
    openai_wire = agent_chat._openai_wire(messages, "system")
    assert len(openai_wire) == 4
    assert openai_wire[3]["role"] == "tool"

    anthropic_wire = agent_chat._anthropic_wire(messages)
    assert len(anthropic_wire) == 3
    assert anthropic_wire[1]["content"][0]["type"] == "text"
