"""Serializa cold-imports de extensiones C (guard contra deadlock).

En Windows, dos hilos cargando extensiones C distintas a la vez pueden
deadlockear el proceso: el hilo A retiene el import lock de Python mientras
carga la DLL del módulo M (esperando el loader lock de Windows); el hilo B
retiene el loader lock cargando la DLL de N y espera el import lock para
importar N. Ciclo → proceso congelado sin traceback.

Cold-imports pesados conocidos: numpy vía pandas (db_import), rpds vía
jsonschema (backend.core.history), Pillow (conversion/canvas), WeasyPrint.
Todo import por primera vez de estos módulos debe ejecutarse bajo
``serialized_import()`` para que nunca se solapen entre hilos.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

_LOCK = threading.RLock()


@contextmanager
def serialized_import() -> Iterator[None]:
    """Mantiene exclusión mutua durante cold-imports de extensiones C."""
    with _LOCK:
        yield
