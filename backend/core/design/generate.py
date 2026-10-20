
from __future__ import annotations

import logging

from backend.core.agent import agent_chat
from backend.core.design import memory as design_memory
from backend.core.design import models
from backend.core.design.prompt import SYSTEM_PROMPT, tool_spec
from backend.core.design.types import JsonObject
from backend.core.integrations import ai_providers

logger = logging.getLogger(__name__)

_MAX_TOKENS = 16_000
_REVIEW_TURNS = 2
_MAX_PROMPT_CHARS = 4_000
_MAX_REVIEW_IMAGES = 8
_REVIEW_DPI = 110


def _slide_images(pdf: bytes, limit: int) -> list[JsonObject]:
    import base64

    import pymupdf

    out: list[JsonObject] = []
    with pymupdf.open(stream=pdf, filetype="pdf") as document:
        for page in document:
            if len(out) >= limit:
                break
            pixmap = page.get_pixmap(dpi=_REVIEW_DPI, alpha=False)
            out.append({"media_type": "image/png", "data_b64": base64.b64encode(pixmap.tobytes("png")).decode("ascii")})
    return out
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


def _review_turn(provider: str, model: str, document: JsonObject, system: str) -> str:
    from backend.core.design.render import render_html
    from backend.utils.pdf_html import write_pdf_sanitized

    try:
        images = _slide_images(write_pdf_sanitized(render_html(document)), _MAX_REVIEW_IMAGES)
    except Exception as err:
        logger.info("[design.generate] no se pudo rasterizar para revisar: %s", err)
        return ""
    if not images:
        return ""

    try:
        reply = agent_chat.chat(
            provider,
            model,
            [
                {
                    "role": "user",
                    "content": (
                        "Estas son las diapositivas que has diseñado, ya renderizadas y en orden. "
                        "Revísalas como director de arte, sin cambiar lo que ya funciona.\n\n"
                        "Señala solo defectos objetivos y de impacto, con este formato por línea:\n"
                        "<diapositiva n>: <qué falla y cómo se corrige>\n\n"
                        "Céntrate en: texto cortado o desbordado, elementos solapados, contraste "
                        "insuficiente, jerarquía plana (todos los textos del mismo peso), "
                        "diapositivas vacías o que no aportan nada al mensaje, y maquetación "
                        "repetida en tres o más seguidas.\n\n"
                        "Si no ves ningún defecto real, responde exactamente: SIN_OBSERVACIONES"
                    ),
                    "images": images,
                }
            ],
            with_tools=False,
            system=system,
            max_tokens=_MAX_TOKENS,
        )
    except Exception as err:
        logger.info("[design.generate] revision no soportada: %s", err)
        return ""

    critique = str(reply.get("text") or "").strip()
    if not critique or "SIN_OBSERVACIONES" in critique:
        return ""
    return critique[:4_000]


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
    ai_providers.get_provider(provider)

    instruction = f"{text}\n\nUsa el formato de página `{page_preset}`." if page_preset else text
    spec = tool_spec()
    system = SYSTEM_PROMPT + design_memory.render_block(design_memory.get_design_memory().load())
    messages: list[JsonObject] = [{"role": "user", "content": instruction}]
    last_error: str | None = None
    critique = ""

    for attempt in range(_REPAIR_TURNS):
        messages[0] = {"role": "user", "content": _user_message(text, attempt, last_error)}
        if critique:
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Estas son las diapositivas que acabas de generar, ya renderizadas. "
                        + critique
                        + "\n\nVuelve a llamar a `create_design` con la versión corregida completa."
                    ),
                }
            )
        reply = agent_chat.chat(
            provider,
            resolved_model,
            messages,
            with_tools=True,
            system=system,
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
                critique = _review_turn(provider, resolved_model, document, system)
                if critique:
                    logger.info("[design.generate] revision turn: %s", critique[:200])
                    continue
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
