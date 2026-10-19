"""Alias compartidos para los documentos JSON que emite el modelo.

``JsonObject`` es la forma del payload de una Design tal como llega del
proveedor: un dict de JSON sin forma fija hasta que ``models.normalize_document``
la convierte. La excepción está marcada con la misma convención que
``core/integrations/types.py``.
"""

from __future__ import annotations

from typing import Any

JsonObject = dict[str, Any]  # allowlist: dict[str, Any]
Note = dict[str, Any]  # allowlist: dict[str, Any]
Memory = dict[str, Any]  # allowlist: dict[str, Any]
