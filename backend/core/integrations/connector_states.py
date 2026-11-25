"""Vocabulario unificado de salud de conectores y cálculo de backoff.

MCP y los conectores cloud medían su estado con vocabularios distintos; este
módulo fija la máquina de estados común y el backoff exponencial acotado que
evita martillear servidores caídos sin impedir el reintento manual.
"""

from __future__ import annotations

STATES = frozenset({"disconnected", "connecting", "needs_auth", "degraded", "healthy", "disabled", "unverified"})

BACKOFF_BASE_S = 5
BACKOFF_CAP_S = 300
BACKOFF_MAX_FAILURES = 8


def backoff_seconds(failures: int) -> int:
    """Espera exponencial acotada: 5s, 10s, 20s… hasta un techo de 5 minutos."""
    if failures < 1:
        return 0
    return int(min(BACKOFF_BASE_S * (2 ** min(failures - 1, BACKOFF_MAX_FAILURES)), BACKOFF_CAP_S))


def normalize_mcp(status: str, *, failures: int = 0, backoff_active: bool = False) -> str:
    """Mapea el estado interno del servidor MCP al vocabulario unificado."""
    if status == "ready":
        return "healthy"
    if status == "unavailable":
        return "degraded" if backoff_active or failures else "disconnected"
    if status == "disabled":
        return "disabled"
    return "unverified"
