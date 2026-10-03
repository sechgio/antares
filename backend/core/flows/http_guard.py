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
    raw = os.environ.get("ANTARES_FLOWS_ALLOW_PRIVATE_HOSTS", "").strip().lower()
    return raw in {"1", "true", "yes"}


def _assert_public_host(url: str) -> None:
    """Rechaza URLs cuyo host no resuelve a una IP pública (SSRF a LAN/localhost)."""
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if not host:
        raise ValueError("http_request requiere una URL con host")
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise ValueError(f"http_request no pudo resolver el host: {host}") from exc
    for info in infos:
        try:
            addr = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        mapped = getattr(addr, "ipv4_mapped", None)
        if mapped is not None:
            addr = mapped
        if not addr.is_global:
            raise ValueError(
                f"http_request no puede apuntar a una dirección no pública ({host}); "
                "si el destino es tu red local de confianza, reinicia con "
                "ANTARES_FLOWS_ALLOW_PRIVATE_HOSTS=1"
            )


def assert_allowed_url(url: str) -> None:
    scheme = urllib.parse.urlparse(url).scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError(f"URL no permitida en http_request (solo http/https): {url[:80]}")
    if not _private_hosts_allowed():
        _assert_public_host(url)


class FlowRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Revalida cada destino de redirect (esquema y host público) y retira
    Authorization cuando el destino no está entre los hosts firmables."""

    def __init__(self, auth_hosts: frozenset[str]) -> None:
        super().__init__()
        self._auth_hosts = auth_hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        assert_allowed_url(newurl)
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        host = (urllib.parse.urlparse(new_req.full_url).hostname or "").lower()
        if host not in self._auth_hosts:
            new_req.headers.pop("Authorization", None)
            new_req.unredirected_hdrs.pop("Authorization", None)
        return new_req
