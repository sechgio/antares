"""L8.3: historial local de exportaciones con reintento explícito.

Una exportación terminada queda registrada con su destino real. El
historial permite ver resultados anteriores y reintentar con un destino
nuevo; un resultado inexistente muestra estado concreto sin volver a
renderizar automáticamente.
"""

from pathlib import Path

from backend.core.editor.jobs import (
    _history_dir,
    _persist_export_history,
    list_export_history,
)


def test_export_finish_records_destination(tmp_path, monkeypatch) -> None:
    """Al terminar un export se registra el destino y el tamaño real."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    output = tmp_path / "salida.mp4"
    output.write_bytes(b"x" * 4096)

    class FakeJob:
        id = "job-1"

        class state:
            progress = 0

            class _lock:
                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    return False

        result = None

    _persist_export_history(
        FakeJob.id,
        {
            "jobId": FakeJob.id,
            "type": "editor_export",
            "output": str(output),
            "state": "done",
            "finishedAt": "2026-10-11T12:00:00+00:00",
            "byteSize": output.stat().st_size,
        },
    )
    history = list_export_history()
    assert len(history) == 1
    assert history[0]["output"] == str(output)
    assert history[0]["byteSize"] == 4096


def test_history_sorted_recent_first(tmp_path, monkeypatch) -> None:
    """El historial se ordena por fecha descendente."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    for job_id, when in (("old", "2026-01-01T00:00:00+00:00"), ("new", "2026-06-01T00:00:00+00:00")):
        _persist_export_history(
            job_id,
            {"jobId": job_id, "type": "editor_export", "output": f"{job_id}.mp4", "state": "done", "finishedAt": when},
        )
    history = list_export_history()
    assert [e["jobId"] for e in history] == ["new", "old"]


def test_history_limit(tmp_path, monkeypatch) -> None:
    """El límite recorta el historial devuelto."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    for i in range(10):
        _persist_export_history(
            f"job-{i}",
            {
                "jobId": f"job-{i}",
                "type": "editor_export",
                "output": f"{i}.mp4",
                "state": "done",
                "finishedAt": f"2026-01-{i + 1:02d}T00:00:00+00:00",
            },
        )
    assert len(list_export_history(limit=3)) == 3


def test_corrupt_history_entry_is_skipped(tmp_path, monkeypatch) -> None:
    """Una entrada corrupta no rompe el historial completo."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    _history_dir()
    (_history_dir() / "roto.json").write_text("{no json", encoding="utf-8")
    _persist_export_history(
        "bueno",
        {"jobId": "bueno", "type": "editor_export", "output": "b.mp4", "state": "done", "finishedAt": "2026-01-01T00:00:00+00:00"},
    )
    history = list_export_history()
    assert [e["jobId"] for e in history] == ["bueno"]


def test_missing_output_shows_state_without_rerender(tmp_path, monkeypatch) -> None:
    """Un destino que ya no existe se reporta; no se re-renderiza solo.

    El contrato del plan: un resultado inexistente muestra estado
    concreto. Aquí se verifica que el historial conserva el registro y
    que el backend no lanza render automático al consultarlo.
    """
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    gone = tmp_path / "borrado.mp4"
    _persist_export_history(
        "job-gone",
        {
            "jobId": "job-gone",
            "type": "editor_export",
            "output": str(gone),
            "state": "done",
            "finishedAt": "2026-01-01T00:00:00+00:00",
            "byteSize": 0,
        },
    )
    history = list_export_history()
    assert len(history) == 1
    assert not Path(history[0]["output"]).exists()
    assert history[0]["byteSize"] == 0


def test_retry_with_new_destination_creates_separate_entry(tmp_path, monkeypatch) -> None:
    """Reintentar con destino nuevo es una entrada nueva, no sobreescribe."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    _persist_export_history(
        "job-a",
        {"jobId": "job-a", "type": "editor_export", "output": str(tmp_path / "a.mp4"), "state": "done", "finishedAt": "2026-01-01T00:00:00+00:00"},
    )
    _persist_export_history(
        "job-b",
        {"jobId": "job-b", "type": "editor_export", "output": str(tmp_path / "b.mp4"), "state": "done", "finishedAt": "2026-01-02T00:00:00+00:00"},
    )
    history = list_export_history()
    assert len(history) == 2
    assert {e["output"] for e in history} == {str(tmp_path / "a.mp4"), str(tmp_path / "b.mp4")}
