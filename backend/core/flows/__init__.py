from __future__ import annotations

from backend.core.flows.store import FlowStore
from backend.utils.lazy import LazySingleton


def _create_store() -> FlowStore:
    return FlowStore()


_store_singleton: LazySingleton[FlowStore] = LazySingleton(_create_store)


def get_flow_store() -> FlowStore:
    return _store_singleton.get()
