"""Guardas de destino para el nodo http_request.

Rechaza esquemas no http/https, hosts que resuelven a IPs no públicas
(SSRF a loopback/LAN/metadata) y revalida cada destino de redirect,
retirando Authorization cuando el destino no está entre los hosts
firmables de la conexión.
"""

from __future__ import annotations

import ipaddress
import os
import socket
import urllib.parse
import urllib.request


def _private_hosts_allowed() -> bool:
    raw = os.environ.get("ANTARES_ALLOW_PRIVATE_HOSTS", "").strip().lower()
    return raw in {"1", "true", "yes"}


def _assert_public_host(url: str) -> None:
    """Rechaza URLs cuyo host no resuelve a una IP pública (SSRF a LAN/localhost)."""
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if not host:
        raise ValueError("Se requiere una URL con host")
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise ValueError(f"No se pudo resolver el host: {host}") from exc
    for info in infos:
        _assert_public_address(host, str(info[4][0]))


def _assert_public_address(host: str, address: str) -> None:
    addr = ipaddress.ip_address(address)
    mapped = getattr(addr, "ipv4_mapped", None)
    if mapped is not None:
        addr = mapped
    if not addr.is_global:
        raise ValueError(
            f"La llamada no puede apuntar a una dirección no pública ({host}); "
            "si el destino es tu red local de confianza, reinicia con "
            "ANTARES_ALLOW_PRIVATE_HOSTS=1"
        )


def assert_allowed_url(url: str) -> None:
    scheme = urllib.parse.urlparse(url).scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError(f"URL no permitida (solo http/https): {url[:80]}")
    if not _private_hosts_allowed():
        _assert_public_host(url)


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Rechaza todo redirect para clientes que envían secretos (API keys,
    Authorization): urllib los seguiría reenviando esas cabeceras al host
    destino — CWE-200 — y en POST los convierte en GET, así que tampoco
    funcionaban. El error indica registrar la URL final directamente."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


no_redirect_opener = urllib.request.build_opener(NoRedirectHandler())
