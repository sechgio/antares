
from __future__ import annotations

import json
from pathlib import Path

from backend.utils.html_sanitizer import sanitize_html_for_pdf

SPEC_PATH = Path(__file__).resolve().parent.parent / "shared" / "html-sanitizer-spec.json"


def test_html_sanitizer_spec_holds_for_cmyk_adapter() -> None:
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    failures: list[str] = []
    for case in spec["cases"]:
        lowered = sanitize_html_for_pdf(case["html"]).lower()
        for needle in case.get("absent", []):
            if needle.lower() in lowered:
                failures.append(f"[cmyk] {case['id']}: output contiene \"{needle}\"")
        for needle in case.get("present", []):
            if needle.lower() not in lowered:
                failures.append(f"[cmyk] {case['id']}: output no contiene \"{needle}\"")
        per_adapter = (case.get("adapters") or {}).get("cmyk", {})
        for needle in per_adapter.get("absent", []):
            if needle.lower() in lowered:
                failures.append(f"[cmyk] {case['id']}: output contiene \"{needle}\"")
        for needle in per_adapter.get("present", []):
            if needle.lower() not in lowered:
                failures.append(f"[cmyk] {case['id']}: output no contiene \"{needle}\"")
    assert not failures, "\n".join(failures)
