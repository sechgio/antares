
from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

_LOCK = threading.RLock()


@contextmanager
def serialized_import() -> Iterator[None]:
    with _LOCK:
        yield
