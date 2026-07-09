"""Regression: conversion must not silently overwrite when out_paths collide."""

from __future__ import annotations

from pathlib import Path

from backend.handlers.conversion import _dedupe_chunk_out_paths, _out_path_key


def test_dedupe_leaves_unique_paths_unchanged() -> None:
    tasks = [
        ("a.jpg", Path("out/a.jpg"), False),
        ("b.jpg", Path("out/b.jpg"), False),
    ]
    reserved: set[str] = set()
    result = _dedupe_chunk_out_paths(tasks, reserved)
    assert result == tasks
    assert _out_path_key(Path("out/a.jpg")) in reserved
    assert _out_path_key(Path("out/b.jpg")) in reserved


def test_dedupe_suffixes_colliding_out_paths() -> None:
    tasks = [
        ("folder1/a.jpg", Path("out/a.jpg"), False),
        ("folder2/a.jpg", Path("out/a.jpg"), False),
        ("folder3/a.jpg", Path("out/a.jpg"), False),
    ]
    logs: list[str] = []
    reserved: set[str] = set()
    result = _dedupe_chunk_out_paths(tasks, reserved, log=logs.append)

    assert result[0][1] == Path("out/a.jpg")
    assert result[1][1] == Path("out/a-2.jpg")
    assert result[2][1] == Path("out/a-3.jpg")
    assert len(logs) == 2
    assert all("Colisión de salida" in msg for msg in logs)


def test_dedupe_is_case_insensitive() -> None:
    # Forward slashes keep pathlib consistent on Windows and Linux CI.
    # The auto-suffix keeps the colliding path's own stem/suffix casing.
    tasks = [
        ("x.jpg", Path("out/Photo.JPG"), False),
        ("y.jpg", Path("out/photo.jpg"), False),
    ]
    reserved: set[str] = set()
    result = _dedupe_chunk_out_paths(tasks, reserved)
    assert result[0][1] == Path("out/Photo.JPG")
    assert result[1][1] == Path("out/photo-2.jpg")
    assert _out_path_key(result[0][1]) != _out_path_key(result[1][1])
    assert _out_path_key(result[0][1]) == _out_path_key(Path("out/photo.jpg"))


def test_dedupe_spans_chunks_via_shared_reserved_set() -> None:
    reserved: set[str] = set()
    chunk1 = _dedupe_chunk_out_paths(
        [("a.jpg", Path("out/same.png"), False)],
        reserved,
    )
    chunk2 = _dedupe_chunk_out_paths(
        [("b.jpg", Path("out/same.png"), False)],
        reserved,
    )
    assert chunk1[0][1] == Path("out/same.png")
    assert chunk2[0][1] == Path("out/same-2.png")
