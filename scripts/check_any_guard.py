"""Fail if backend/core/canvas uses unallowlisted `dict[str, Any]`.

Fuera de canvas solo advierte; el techo de crecimiento lo aplica
check:ratchet mediante la métrica `dictAnyBackend` de .quality-baseline.json.
Exención por línea: `# allowlist`, `# type: ignore` o `# noqa`.
"""

from __future__ import annotations

import pathlib
import re

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
        print("El techo fuera de canvas lo aplica check:ratchet (dictAnyBackend en .quality-baseline.json).")
        print("Canvas OK: 0 violaciones en backend/core/canvas.")
        return 0
    print(f"Any guard: OK: {total} dict[str,Any] all allowlisted.")
    return 0

if __name__ == "__main__":
    raise SystemExit(check())
