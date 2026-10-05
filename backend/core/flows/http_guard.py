"""Guardas de destino para el nodo http_request.

Rechaza esquemas no http/https, hosts que resuelven a IPs no públicas
(SSRF a loopback/LAN/metadata) y revalida cada destino de redirect,
retirando Authorization cuando el destino no está entre los hosts
firmables de la conexión.
"""

from __future__ import annotations

import http.client
import ipaddress
import os
import socket
import ssl
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
        _assert_public_address(host, str(info[4][0]))


def _assert_public_address(host: str, address: str) -> None:
    addr = ipaddress.ip_address(address)
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


def _create_public_connection(
    address: tuple[str, int], timeout: object = None, source_address: tuple[str, int] | None = None
) -> socket.socket:
    host, port = address
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    for info in infos:
        _assert_public_address(host, str(info[4][0]))
    error: OSError = OSError("getaddrinfo returns an empty list")
    for family, socktype, proto, _canonname, sockaddr in infos:
        sock = None
        try:
            sock = socket.socket(family, socktype, proto)
            if isinstance(timeout, (int, float)) or timeout is None:
                sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            # sockaddr es la IP ya validada: no volver a resolver el hostname.
            sock.connect(sockaddr)
            return sock
        except OSError as exc:
            if sock is not None:
                sock.close()
            error = exc
    raise error


class _PublicHTTPConnection(http.client.HTTPConnection):
    def connect(self) -> None:
        self._create_connection = _create_public_connection
        super().connect()


class _PublicHTTPSConnection(_PublicHTTPConnection, http.client.HTTPSConnection):
    pass


class _PublicHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req: urllib.request.Request) -> http.client.HTTPResponse:
        return self.do_open(_PublicHTTPConnection, req)


class _PublicHTTPSHandler(urllib.request.HTTPSHandler):
    _context: ssl.SSLContext | None

    def https_open(self, req: urllib.request.Request) -> http.client.HTTPResponse:
        return self.do_open(_PublicHTTPSConnection, req, context=self._context)


def build_flow_opener(auth_hosts: frozenset[str]) -> urllib.request.OpenerDirector:
    handlers: list[urllib.request.BaseHandler] = [FlowRedirectHandler(auth_hosts)]
    if not _private_hosts_allowed():
        # Un proxy resolvería el destino fuera de la validación del socket local.
        handlers.extend([urllib.request.ProxyHandler({}), _PublicHTTPHandler(), _PublicHTTPSHandler()])
    return urllib.request.build_opener(*handlers)


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Rechaza todo redirect para clientes que envían secretos (API keys,
    Authorization): urllib los seguiría reenviando esas cabeceras al host
    destino — CWE-200 — y en POST los convierte en GET, así que tampoco
    funcionaban. El error indica registrar la URL final directamente."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


no_redirect_opener = urllib.request.build_opener(NoRedirectHandler())


class FlowRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Revalida cada destino y retira credenciales al cambiar de origen."""

    def __init__(self, auth_hosts: frozenset[str]) -> None:
        super().__init__()
        self._auth_hosts = auth_hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if req.has_header("Authorization") and urllib.parse.urlparse(newurl).scheme.lower() != "https":
            raise ValueError("Las redirecciones con credenciales requieren HTTPS")
        assert_allowed_url(newurl)
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new_req is None:
            return None
        host = (urllib.parse.urlparse(new_req.full_url).hostname or "").lower()
        source = urllib.parse.urlparse(req.full_url)
        target = urllib.parse.urlparse(new_req.full_url)
        source_origin = (source.scheme.lower(), source.hostname, source.port or (443 if source.scheme == "https" else 80))
        target_origin = (target.scheme.lower(), target.hostname, target.port or (443 if target.scheme == "https" else 80))
        if source_origin != target_origin:
            # Cualquier cabecera personalizada puede contener una credencial.
            for bucket in (new_req.headers, new_req.unredirected_hdrs):
                for key in list(bucket):
                    if key.lower() not in {"accept", "accept-encoding", "accept-language", "user-agent"}:
                        bucket.pop(key)
        if host not in self._auth_hosts:
            new_req.headers.pop("Authorization", None)
            new_req.unredirected_hdrs.pop("Authorization", None)
        return new_req
