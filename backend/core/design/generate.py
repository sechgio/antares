"""Generación de un Design con el modelo del usuario.

Reutiliza el cliente de chat de flujos (`agent_chat.chat`) para que la feature
funcione con **cualquier proveedor BYOK** —OpenAI, Anthropic, OpenRouter u
Ollama— sin una sola ruta de código por proveedor: el estilo de cableado vive
en `shared/ai-providers-catalog.json` y `agent_chat` ya lo adapta.

El modelo no escribe texto que haya que parsear: se le ofrece una única
herramienta, `create_design`, y su payload es el documento.
"""

from __future__ import annotations

import logging

from backend.core.design import models
from backend.core.design.prompt import SYSTEM_PROMPT, tool_spec
from backend.core.design.types import JsonObject
from backend.core.flows import agent_chat, ai_providers

logger = logging.getLogger(__name__)

# El payload de la herramienta es un documento entero: 12 diapositivas con sus
# campos son del orden de 3-5k tokens, muy por encima del 2048 por defecto.
_MAX_TOKENS = 16_000
_MAX_PROMPT_CHARS = 4_000
_REPAIR_TURNS = 2


class DesignGenerationError(ValueError):
    """El modelo no devolvió un Design utilizable tras los reintentos."""


def resolve_model(provider: str, model: str | None) -> str:
    if not isinstance(model, str) or not model.strip():
        default = str(ai_providers.public_state(provider).get("default_model") or "")
        model = default
    model = model.strip()
    if not model:
        raise DesignGenerationError(
            f"El proveedor {provider} no tiene modelo configurado. Elige uno en Ajustes."
        )
    return model


def _user_message(prompt: str, attempt: int, last_error: str | None) -> str:
    if attempt == 0:
        return prompt
    return (
        f"{prompt}\n\n"
        "Tu intento anterior no produjo un documento válido"
        + (f" ({last_error})" if last_error else "")
        + ". Vuelve a llamar a `create_design` con el documento completo, respetando el esquema."
    )


def generate_design(
    provider: str,
    prompt: str,
    model: str | None = None,
    *,
    page_preset: str | None = None,
) -> JsonObject:
    """Pide al modelo un Design y lo normaliza. Lanza `DesignGenerationError` si no lo consigue."""
    text = " ".join(str(prompt or "").split())
    if not text:
        raise DesignGenerationError("Escribe qué quieres que presente el diseño.")
    text = text[:_MAX_PROMPT_CHARS]

    resolved_model = resolve_model(provider, model)
    ai_providers.get_provider(provider)  # valida el nombre antes de gastar la llamada

    instruction = f"{text}\n\nUsa el formato de página `{page_preset}`." if page_preset else text
    spec = tool_spec()
    messages: list[JsonObject] = [{"role": "user", "content": instruction}]
    last_error: str | None = None

    for attempt in range(_REPAIR_TURNS):
        messages[0] = {"role": "user", "content": _user_message(text, attempt, last_error)}
        reply = agent_chat.chat(
            provider,
            resolved_model,
            messages,
            with_tools=True,
            system=SYSTEM_PROMPT,
            extra_tools=[spec],
            max_tokens=_MAX_TOKENS,
        )
        calls = [c for c in reply.get("calls") or [] if str(c.get("name") or "") == spec["name"]]
        if calls:
            payload = calls[0].get("params")
            if isinstance(payload, dict):
                document = models.normalize_document(payload)
                document["prompt"] = text
                if page_preset:
                    document["page"] = models.normalize_page({"preset": page_preset})
                if not str(document.get("name") or "").strip():
                    document["name"] = "Diseño"
                return document
            last_error = "los argumentos de la herramienta no eran un objeto"
        elif str(reply.get("text") or "").strip():
            last_error = "respondiste con texto en vez de llamar a la herramienta"
        else:
            last_error = "la respuesta no contenía ninguna llamada a herramienta"

        logger.info("[design.generate] invalid turn %s/%s: %s", attempt + 1, _REPAIR_TURNS, last_error)

    raise DesignGenerationError(
        "El modelo no devolvió un diseño válido. "
        f"({last_error or 'motivo desconocido'}) "
        "Prueba con otro modelo o acorta la petición."
    )
