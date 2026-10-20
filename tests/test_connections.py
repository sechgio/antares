from __future__ import annotations

import json
import threading

import pytest

from backend.core.integrations import connections, vault


def test_vault_roundtrip(tmp_path):
    path = tmp_path / "conn.json"
    vault.seal("github", path, {"access_token": "abc", "refresh_token": "r"})
    assert vault.open_sealed("github", path) == {"access_token": "abc", "refresh_token": "r"}


def test_vault_rejects_tampered_payload(tmp_path):
    path = tmp_path / "conn.json"
    vault.seal("github", path, {"access_token": "abc"})
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["data"] = raw["data"][:-4] + "AAAA"
    path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ValueError):
        vault.open_sealed("github", path)


def test_vault_missing_returns_none(tmp_path):
    assert vault.open_sealed("github", tmp_path / "none.json") is None


def test_provider_specs_loaded():
    specs = connections.load_provider_specs()
    assert "github" in specs
    assert "slack" in specs
    assert specs["github"]["auth"]["token_url"].startswith("https://")


def test_tokens_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(connections, "user_data_path", lambda rel: tmp_path / rel)
    connections.put_tokens("github", {"access_token": "tok", "refresh_token": "r", "expiry_date": 9_999_999_999_999})
    loaded = connections.get_tokens("github")
    assert loaded is not None and loaded["access_token"] == "tok"
    assert connections.status("github")["connected"] is True
    connections.delete_tokens("github")
    assert connections.get_tokens("github") is None


def test_unknown_provider_rejected():
    with pytest.raises(ValueError, match="desconocido"):
        connections.put_tokens("nope", {"access_token": "x"})


def test_fresh_access_token_refreshes(tmp_path, monkeypatch):
    monkeypatch.setattr(connections, "user_data_path", lambda rel: tmp_path / rel)
    connections.put_tokens(
        "github",
        {
            "access_token": "old",
            "refresh_token": "r",
            "client_id": "cid",
            "client_secret": "cs",
            "expiry_date": 1,
        },
    )
    calls: list[dict] = []

    def fake_post(url, fields, basic):
        calls.append({"url": url, "fields": fields})
        return {"access_token": "new-tok", "expires_in": 3600}

    monkeypatch.setattr(connections, "_post_form", fake_post)
    assert connections.fresh_tokens("github")["access_token"] == "new-tok"
    assert calls[0]["url"] == connections.load_provider_specs()["github"]["auth"]["token_url"]
    tokens = connections.get_tokens("github")
    assert tokens is not None and tokens["access_token"] == "new-tok"


def test_fresh_access_token_requires_connection(tmp_path, monkeypatch):
    monkeypatch.setattr(connections, "user_data_path", lambda rel: tmp_path / rel)
    with pytest.raises(ValueError, match="Sin conexión"):
        connections.fresh_tokens("github")["access_token"]


@pytest.fixture()
def expired_connection(tmp_path, monkeypatch):
    monkeypatch.setattr(connections, "user_data_path", lambda rel: tmp_path / rel)
    monkeypatch.setattr(vault, "user_data_path", lambda rel: tmp_path / rel)
    connections.put_tokens("zoom", {
        "access_token": "old", "refresh_token": "old-refresh", "client_id": "client", "expiry_date": 1,
    })
    return "zoom"


@pytest.mark.parametrize("change", ["disconnect", "replace"])
def test_refresh_cannot_restore_changed_connection(expired_connection, monkeypatch, change):
    provider = expired_connection
    entered, release = threading.Event(), threading.Event()
    results = []

    def post(*args):
        entered.set()
        assert release.wait(3)
        return {"access_token": "refreshed", "refresh_token": "new-refresh", "expires_in": 3600}

    def refresh():
        try:
            results.append(connections.fresh_tokens(provider)["access_token"])
        except ValueError as exc:
            results.append(exc)

    monkeypatch.setattr(connections, "_post_form", post)
    worker = threading.Thread(target=refresh)
    worker.start()
    try:
        assert entered.wait(3)
        if change == "disconnect":
            connections.delete_tokens(provider)
        else:
            connections.put_tokens(provider, {"access_token": "replacement"})
    finally:
        release.set()
        worker.join(timeout=3)
    assert not worker.is_alive()
    assert len(results) == 1 and isinstance(results[0], ValueError)
    tokens = connections.get_tokens(provider)
    assert tokens is None if change == "disconnect" else tokens["access_token"] == "replacement"


def test_concurrent_refresh_reuses_rotated_token(expired_connection, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    calls, results = [], []

    def post(url, fields, basic):
        calls.append(fields["refresh_token"])
        if len(calls) > 1:
            raise ValueError("invalid_grant")
        entered.set()
        assert release.wait(3)
        return {"access_token": "refreshed", "refresh_token": "new-refresh", "expires_in": 3600}

    def refresh():
        try:
            results.append(connections.fresh_tokens(expired_connection)["access_token"])
        except ValueError as exc:
            results.append(exc)

    monkeypatch.setattr(connections, "_post_form", post)
    first, second = threading.Thread(target=refresh), threading.Thread(target=refresh)
    first.start()
    try:
        assert entered.wait(3)
        second.start()
        second.join(timeout=0.1)
    finally:
        release.set()
        first.join(timeout=3)
        if second.ident is not None:
            second.join(timeout=3)
    assert not first.is_alive() and not second.is_alive()
    assert calls == ["old-refresh"]
    assert results == ["refreshed", "refreshed"]
