from __future__ import annotations

import os
import urllib.request


def _private_hosts_allowed() -> bool:
    raw = os.environ.get("ANTARES_ALLOW_PRIVATE_HOSTS", "").strip().lower()
    return raw in {"1", "true", "yes"}


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Rechaza todo redirect para clientes que envían secretos (API keys,
    Authorization): urllib los seguiría reenviando esas cabeceras al host
    destino — CWE-200 — y en POST los convierte en GET, así que tampoco
    funcionaban. El error indica registrar la URL final directamente."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


no_redirect_opener = urllib.request.build_opener(NoRedirectHandler())
