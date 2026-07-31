"""Tests for report generator template handlers."""

from pathlib import Path

from backend.handlers import templates


def test_templates_list_and_get_across_multiple_dirs(tmp_path: Path, monkeypatch) -> None:
    dir1 = tmp_path / "user_templates"
    dir2 = tmp_path / "bundled_templates"
    dir1.mkdir()
    dir2.mkdir()

    (dir1 / "custom_user.html").write_text("<h1>Custom User Template</h1>", encoding="utf-8")
    (dir2 / "bundled_report.html").write_text("<h1>Bundled Report</h1>", encoding="utf-8")
    (dir2 / "custom_user.html").write_text("<h1>Overridden Bundled</h1>", encoding="utf-8")

    monkeypatch.setattr(templates, "_preview_template_dirs", lambda: [dir1, dir2])

    res = templates.templates_list({})
    tmpl_list = res.get("templates", [])

    names = [t["name"] for t in tmpl_list]
    assert "custom_user.html" in names
    assert "bundled_report.html" in names
    assert all(t["source"] == "html" for t in tmpl_list)

    get_user = templates.template_get({"name": "custom_user.html"})
    assert "Custom User Template" in get_user["content"]

    get_bundled = templates.template_get({"name": "bundled_report.html"})
    assert "Bundled Report" in get_bundled["content"]
