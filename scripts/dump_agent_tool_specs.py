"""Vuelca el catálogo de herramientas del agente como JSON en stdout.

Consumido por scripts/check-budgets.js para medir los tokens del prompt base
sin arrancar la aplicación: reproduce exactamente el payload que recibe el
puente de Electron al pedir agent_internal_tools.
"""

import json
import sys

from backend.handlers.agent_internal import _tools


def main() -> None:
    payload = _tools({})
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
