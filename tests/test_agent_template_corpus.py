from __future__ import annotations

import pytest

from backend.core.agent import documents


@pytest.mark.parametrize("template", documents.catalog("html")["templates"], ids=lambda item: item["template_id"])
def test_each_registered_html_template_prepares_native_render_and_rejects_invalid_rows(template, tmp_path):
    profile = documents.describe(template)
    values = {field: "0" for field in profile["fields"]}
    values.update({"OT": "OT-CORPUS", "FECHA_TRABAJO": "2026-10-11"})
    for field in profile["fields"]:
        if "fecha" in field.casefold():
            values[field] = "2026-10-11"
        if field in {"productos", "personal_tecnico"}:
            values[field] = "[]"
    params = {**template, "filename_pattern": "corpus.pdf", "rows": [values]}
    plan = documents.render_plan(params, {}, tmp_path / "drafts")
    assert not plan.get("complete"), plan.get("result")
    assert plan["metadata"]["template_revision"] == profile["revision"]
    assert all(item["htmls"] and "<html" in item["htmls"][0].lower() for item in plan["items"])
    assert list(tmp_path.rglob("*.pdf")) == []
    with pytest.raises(ValueError, match="filas"):
        documents.render_plan({**params, "rows": ["datos inválidos"]}, {}, tmp_path / "drafts")
