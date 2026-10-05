from __future__ import annotations

from backend.core.flows.store import FlowStore
from backend.utils.lazy import LazySingleton

_store_singleton: LazySingleton[FlowStore] = LazySingleton(FlowStore)


def get_flow_store() -> FlowStore:
    return _store_singleton.get()
