from __future__ import annotations

from typing import Literal, get_args

ReportStatus = Literal["draft", "completed"]
ReservoirType = Literal["ELEVADO", "ENTERRADO", "SEMIENTERRADO", "APOYADO", "CISTERNA"]

REPORT_STATUS_VALUES: frozenset[str] = frozenset(get_args(ReportStatus))
RESERVOIR_TYPES: frozenset[str] = frozenset(get_args(ReservoirType))
