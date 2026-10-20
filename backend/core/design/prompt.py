"""Instrucción y contrato de herramienta para que el modelo emita un Design.

El ``SYSTEM_PROMPT`` condensa las reglas de diseño que Claude codifica en su
skill ``pptx`` (dominio cromático, contraste de tamaño, una visual por
diapositiva, nada de texto plano, nada de barras decorativas). Los modelos
locales pequeños no respetan reglas implícitas: por eso van explícitas y
limitadas a siete layouts que el render sabe pintar.
"""

from __future__ import annotations

from backend.core.design.models import FONTS, LAYOUTS, PAGE_PRESETS
from backend.core.design.types import JsonObject

LAYOUT_GUIDE: dict[str, str] = {
    "title": "Portada. Título grande + subtítulo. Solo la primera diapositiva.",
    "section": "Separador de sección. Título grande y poco más.",
    "bullets": "Título + lista de 3-6 puntos cortos en `bullets`. El layout por defecto.",
    "twoColumn": "Título + dos listas (`left` y `right`) para comparar o contrastar.",
    "stat": "Una cifra grande (`stat.value`) + su etiqueta (`stat.label`), y texto de apoyo en `body`.",
    "quote": "Una cita (`quote.text`) + autor (`quote.author`).",
    "blank": "Solo texto corrido en `body`, sin título.",
}

SYSTEM_PROMPT = """\
Eres un director de arte. Produces presentaciones con la herramienta `create_design`.

El usuario te pide una presentación. Tu trabajo es decidir el contenido, la
estructura y la dirección visual, y emitirlos como un único documento.

## Cómo estructurar

- Emite entre 5 y 12 diapositivas. Menos de 5 es:poco; más de 12 es un documento.
- Abre con `title`. Cierra con `stat`, `quote` o `section`, nunca con `bullets`.
- Un mensaje por diapositiva. El título afirma la conclusión, no la etiqueta.
- Un separador `section` antes de cada bloque temático de 3+ diapositivas.
- Alterna layouts. No uses `bullets` más de dos veces seguidas.

## Dirección visual

- Elige una paleta **acorde al tema**, no un azul genérico. Un color domina
  (60-70% del peso visual), uno o dos lo apoyan y un acento marca lo importante.
- Fondo oscuro para portada y cierre, fondo claro para el contenido. O oscuro
  entero, si te lo piden.
- `accent` es tu color fuerte; `accentAlt` es su contrapunto oscuro.

## Reglas de contenido

- Nunca una diapositiva de solo texto sin estructura. `bullets` lleva lista;
  `stat` lleva cifra; `quote` lleva cita; `twoColumn` lleva dos lados.
- Los puntos son frases cortas, no párrafos. Como mucho 10 palabras por punto.
- Cada punto de `bullets` es su propio elemento del array; nunca los juntes en `body`.
- No inventes cifras, fechas ni nombres propios que no estén en la petición.
  Si te faltan datos, usa `stat` con una etiqueta que admita la incertidumbre.
- Las notas del ponente van en `notes`; no las pongas en la diapositiva.
- No escribas "Gracias", "Preguntas", "Introducción" como contenido.

## Formato

- Un `layout` por diapositiva, elegido de la lista de layouts.
- Los colores son hex de 6 dígitos (`#RRGGBB`), sin alfa y sin `#RGBA`.
- Las fuentes salen de la lista permitida.
- Escribe en el idioma del usuario.

Cuando estés listo, llama a `create_design` con el documento completo. No
describas el diseño en texto antes de llamar a la herramienta: la herramienta
es el resultado.
"""


def _theme_schema(defaults: dict[str, str]) -> JsonObject:
    return {
        "type": "object",
        "required": ["background", "surface", "text", "muted", "accent", "accentAlt", "headFont", "bodyFont"],
        "properties": {
            "background": {"type": "string", "description": "Fondo dominante, hex #RRGGBB."},
            "surface": {"type": "string", "description": "Fondo secundario para bloques, hex #RRGGBB."},
            "text": {"type": "string", "description": "Color del texto principal, hex #RRGGBB."},
            "muted": {"type": "string", "description": "Color secundario y de etiquetas, hex #RRGGBB."},
            "accent": {"type": "string", "description": "Color de acento dominante, hex #RRGGBB."},
            "accentAlt": {"type": "string", "description": "Contrapunto oscuro del acento, hex #RRGGBB."},
            "headFont": {"type": "string", "enum": sorted(FONTS)},
            "bodyFont": {"type": "string", "enum": sorted(FONTS)},
        },
        "additionalProperties": False,
    }


def _slide_schema() -> JsonObject:
    return {
        "type": "object",
        "required": ["layout"],
        "properties": {
            "layout": {"type": "string", "enum": sorted(LAYOUTS)},
            "title": {"type": "string", "description": "Título de la diapositiva. Sin punto final."},
            "subtitle": {"type": "string", "description": "Subtítulo o bajada."},
            "body": {"type": "string", "description": "Párrafo corrido. Solo para `blank` y apoyo de `stat`."},
            "bullets": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Lista de 3-6 puntos cortos (layout `bullets`).",
            },
            "left": {"type": "array", "items": {"type": "string"}, "description": "Puntos de la columna izquierda (twoColumn)."},
            "right": {"type": "array", "items": {"type": "string"}, "description": "Puntos de la columna derecha (twoColumn)."},
            "stat": {
                "type": "object",
                "properties": {
                    "value": {"type": "string", "description": "La cifra grande."},
                    "label": {"type": "string", "description": "Qué mide la cifra."},
                },
                "additionalProperties": False,
            },
            "quote": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "author": {"type": "string"},
                },
                "additionalProperties": False,
            },
            "notes": {"type": "string", "description": "Notas del ponente. No se renderizan en la diapositiva."},
        },
        "additionalProperties": False,
    }


def tool_spec() -> JsonObject:
    """Spec de la herramienta que el modelo debe invocar, en formato neutro."""
    defaults = {
        "background": "#FFFFFF", "surface": "#F3F4F6", "text": "#111827",
        "muted": "#6B7280", "accent": "#2563EB", "accentAlt": "#0F172A",
        "headFont": "Cambria", "bodyFont": "Calibri",
    }
    guide = "\n".join(f"- `{name}`: {desc}" for name, desc in LAYOUT_GUIDE.items())
    return {
        "name": "create_design",
        "description": f"Emite la presentación completa como un documento.\n\nLayouts disponibles:\n{guide}",
        "gated": False,
        "inputSchema": {
            "type": "object",
            "required": ["name", "page", "theme", "slides"],
            "properties": {
                "name": {"type": "string", "description": "Título de la presentación."},
                "page": {
                    "type": "object",
                    "required": ["preset"],
                    "properties": {
                        "preset": {
                            "type": "string",
                            "enum": sorted(PAGE_PRESETS),
                            "description": "`16x9` para presentaciones; `a4` para documentos.",
                        }
                    },
                    "additionalProperties": False,
                },
                "theme": _theme_schema(defaults),
                "slides": {"type": "array", "items": _slide_schema(), "minItems": 3, "maxItems": 40},
            },
            "additionalProperties": False,
        },
    }
