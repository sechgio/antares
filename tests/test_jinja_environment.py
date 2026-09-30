from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from backend.core.jinja_environment import make_cached_jinja_environment, resolve_core_templates_dir


def test_resolve_core_templates_dir_prefers_bundled_path(tmp_path: Path) -> None:
    module_file = tmp_path / "backend" / "core" / "feature" / "rendering.py"
    module_file.parent.mkdir(parents=True)
    bundled = tmp_path / "backend" / "templates"
    bundled.mkdir(parents=True)
    (tmp_path / "backend" / "core" / "templates").mkdir()

    assert resolve_core_templates_dir(module_file) == bundled.resolve()


def test_resolve_core_templates_dir_falls_back_to_core_path(tmp_path: Path) -> None:
    module_file = tmp_path / "backend" / "core" / "feature" / "rendering.py"
    module_file.parent.mkdir(parents=True)
    fallback = tmp_path / "backend" / "core" / "templates"
    fallback.mkdir(parents=True)

    assert resolve_core_templates_dir(module_file) == fallback.resolve()


def test_cached_environment_reuses_configured_instance(tmp_path: Path) -> None:
    template = tmp_path / "report.html"
    template.write_text("{{ label }} {{ value|upper }}", encoding="utf-8")
    get_environment = make_cached_jinja_environment(
        lambda: tmp_path,
        "report.html",
        global_values={"label": "report"},
        filters={"upper": lambda value: str(value).upper()},
    )

    first = get_environment()
    second = get_environment()

    assert first is second
    assert first.get_template("report.html").render(value="ready") == "report READY"


def test_cached_environment_rebuilds_when_template_changes(tmp_path: Path) -> None:
    template = tmp_path / "report.html"
    template.write_text("first", encoding="utf-8")
    get_environment = make_cached_jinja_environment(lambda: tmp_path, "report.html")
    first = get_environment()
    previous_mtime = template.stat().st_mtime_ns

    template.write_text("second", encoding="utf-8")
    os.utime(template, ns=(previous_mtime + 1_000_000_000, previous_mtime + 1_000_000_000))
    second = get_environment()

    assert second is not first
    assert second.get_template("report.html").render() == "second"


def test_cached_environment_initializes_once_across_threads(tmp_path: Path) -> None:
    (tmp_path / "report.html").write_text("ready", encoding="utf-8")
    get_environment = make_cached_jinja_environment(lambda: tmp_path, "report.html")

    with ThreadPoolExecutor(max_workers=8) as executor:
        environments = list(executor.map(lambda _index: get_environment(), range(24)))

    assert all(environment is environments[0] for environment in environments)
