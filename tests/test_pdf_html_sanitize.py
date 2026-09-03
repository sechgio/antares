
from __future__ import annotations

import threading

import pytest
import weasyprint

from backend.utils import pdf_html
from backend.utils.pdf_html import deny_external_url_fetcher, write_pdf_sanitized


@pytest.fixture(autouse=True)
def _reset_pdf_cache() -> None:
    pdf_html.reset_pdf_cache_for_tests()
    yield
    pdf_html.reset_pdf_cache_for_tests()


def test_deny_external_url_fetcher_blocks_http() -> None:
    resp = deny_external_url_fetcher("https://evil.example/x.png")
    file_obj = getattr(resp, "_file_obj", None)
    assert file_obj is not None
    assert file_obj.read() == b""


def test_write_pdf_sanitized_produces_pdf_from_data_uri() -> None:
    tiny = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'></head>"
        f"<body><img src='data:image/png;base64,{tiny}'/></body></html>"
    )
    pdf = write_pdf_sanitized(html)
    assert pdf.startswith(b"%PDF")


def test_font_config_reused_within_same_thread() -> None:
    first = pdf_html._thread_font_config()
    second = pdf_html._thread_font_config()
    assert first is second


def test_font_config_isolated_across_threads() -> None:
    configs: list[object] = []
    barrier = threading.Barrier(2)

    def worker() -> None:
        barrier.wait()
        configs.append(pdf_html._thread_font_config())

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(configs) == 2
    assert configs[0] is not configs[1]


def test_write_pdf_sanitized_passes_thread_font_config(monkeypatch) -> None:
    captured: dict[str, object] = {}
    sentinel = object()
    monkeypatch.setattr(pdf_html, "_thread_font_config", lambda: sentinel)

    class FakeHTML:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def write_pdf(self, target, **kwargs) -> None:
            captured.update(kwargs)
            target.write(b"%PDF-fake")

    monkeypatch.setattr(weasyprint, "HTML", FakeHTML)
    pdf = write_pdf_sanitized("<html><body>x</body></html>")
    assert pdf.startswith(b"%PDF")
    assert captured.get("font_config") is sentinel


def test_write_pdf_sanitized_cache_hit_skips_second_render(monkeypatch) -> None:
    calls = {"n": 0}

    class FakeHTML:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def write_pdf(self, target, **kwargs) -> None:
            calls["n"] += 1
            target.write(b"%PDF-cached-body")

    monkeypatch.setattr(weasyprint, "HTML", FakeHTML)
    html = "<html><body>same-payload</body></html>"
    first = write_pdf_sanitized(html)
    second = write_pdf_sanitized(html)
    assert first == second == b"%PDF-cached-body"
    assert calls["n"] == 1


def test_write_pdf_sanitized_cache_miss_on_different_html(monkeypatch) -> None:
    calls = {"n": 0}

    class FakeHTML:
        def __init__(self, *args, **kwargs) -> None:
            self.kwargs = kwargs

        def write_pdf(self, target, **kwargs) -> None:
            calls["n"] += 1
            target.write(f"%PDF-{calls['n']}".encode("ascii"))

    monkeypatch.setattr(weasyprint, "HTML", FakeHTML)
    a = write_pdf_sanitized("<html><body>a</body></html>")
    b = write_pdf_sanitized("<html><body>b</body></html>")
    assert a != b
    assert calls["n"] == 2


def test_write_pdf_sanitized_does_not_cache_oversized_pdf(monkeypatch) -> None:
    calls = {"n": 0}
    oversized = b"%PDF-" + (b"x" * (pdf_html._PDF_CACHE_MAX_BYTES + 1))

    class FakeHTML:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def write_pdf(self, target, **kwargs) -> None:
            calls["n"] += 1
            target.write(oversized)

    monkeypatch.setattr(weasyprint, "HTML", FakeHTML)
    html = "<html><body>huge</body></html>"
    assert write_pdf_sanitized(html) == oversized
    assert write_pdf_sanitized(html) == oversized
    assert calls["n"] == 2


def test_reset_pdf_cache_for_tests_clears_entries(monkeypatch) -> None:
    calls = {"n": 0}

    class FakeHTML:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def write_pdf(self, target, **kwargs) -> None:
            calls["n"] += 1
            target.write(b"%PDF-r")

    monkeypatch.setattr(weasyprint, "HTML", FakeHTML)
    html = "<html><body>reset-me</body></html>"
    write_pdf_sanitized(html)
    pdf_html.reset_pdf_cache_for_tests()
    write_pdf_sanitized(html)
    assert calls["n"] == 2
