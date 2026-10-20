from __future__ import annotations

from collections.abc import Callable
from typing import Any


class ImmediateFuture:
    def __init__(self, result: Any) -> None:
        self._result = result

    def result(self) -> Any:
        return self._result

    def cancelled(self) -> bool:
        return False

    def cancel(self) -> bool:
        return False


class RecordingScheduler:
    def __init__(self) -> None:
        self.submitted: list[Any] = []

    def submit_heavy(
        self,
        fn: Callable[[Any], Any],
        task: Any,
        *,
        block: bool = False,
        cancel_check: Callable[[], bool] | None = None,
    ) -> ImmediateFuture:
        self.submitted.append(task)
        return ImmediateFuture(fn(task))
