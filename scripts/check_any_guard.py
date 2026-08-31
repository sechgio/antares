#!/usr/bin/env python
"""Fail if new canvas code uses unallowlisted `dict[str, Any]`.

Allowlist: line must contain `# allowlist`, `# type: ignore` or `# noqa`.

Usage:
  python scripts/check_any_guard.py              # check backend/
  python scripts/check_any_guard.py --baseline   # print current counts
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "backend"
PAT_DICT = re.compile(r"dict\[str,\s*Any\]")
ALLOW = re.compile(r"#\s*(allowlist|type:\s*ignore|noqa\b)", re.IGNORECASE)

def check() -> int:
    violations: list[str] = []
    canvas_violations: list[str] = []
    total = 0
    violation_count = 0
    canvas_violation_count = 0
    for p in ROOT.rglob("*.py"):
        for i, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            occurrences = len(PAT_DICT.findall(line))
            if not occurrences:
                continue
            total += occurrences
            if not ALLOW.search(line):
                violation_count += occurrences
                msg = f"{p.relative_to(ROOT.parent)}:{i}: {line.strip()[:120]}"
                violations.append(msg)
                if "backend/core/canvas" in str(p).replace("\\", "/"):
                    canvas_violation_count += occurrences
                    canvas_violations.append(msg)
    if canvas_violations:
        print(f"Any guard FAIL: {canvas_violation_count} `dict[str, Any]` sin allowlist en canvas (de {total} total):")
        for v in canvas_violations[:20]:
            print(f"  {v}")
        print("\nFix canvas: usa `CanvasDocument` / `TypedDict` o añade `# allowlist: dict[str, Any]`.")
        return 1
    if violations:
        print(f"Any guard WARN: {violation_count} `dict[str, Any]` sin allowlist (de {total} total) fuera de canvas.")
        print("Canvas OK: 0 violaciones en backend/core/canvas.")
        return 0
    print(f"Any guard: OK: {total} dict[str,Any] all allowlisted.")
    return 0

if __name__ == "__main__":
    if "--baseline" in sys.argv:
        c_any = sum(len(re.findall(r"\bAny\b", f.read_text(encoding="utf-8", errors="ignore"))) for f in ROOT.rglob("*.py"))
        c_dict = sum(len(PAT_DICT.findall(f.read_text(encoding="utf-8", errors="ignore"))) for f in ROOT.rglob("*.py"))
        print(f"Any: {c_any}, dict[str,Any]: {c_dict}, files: {len(list(ROOT.rglob('*.py')))}")
        raise SystemExit(0)
    raise SystemExit(check())
