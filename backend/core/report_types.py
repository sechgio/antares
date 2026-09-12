from __future__ import annotations

from typing import Literal

ReportStatus = Literal["draft", "completed"]
ReservoirType = Literal["ELEVADO", "ENTERRADO", "SEMIENTERRADO", "APOYADO", "CISTERNA"]

REPORT_STATUS_VALUES: frozenset[str] = frozenset({"draft", "completed"})
RESERVOIR_TYPES: frozenset[str] = frozenset({"ELEVADO", "ENTERRADO", "SEMIENTERRADO", "APOYADO", "CISTERNA"})
