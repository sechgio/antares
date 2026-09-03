
from __future__ import annotations

from pathlib import Path

from backend.core.naming import resolve_rename_plan
from backend.core.renamer import RenamerEngine
from backend.handlers import conversion


def test_resolve_rename_plan_key_column_prefiere_stem(monkeypatch, tmp_path) -> None:
    files = [str(tmp_path / n) for n in ("PLAN_001.jpg", "PLAN_002.jpg")]
    for f in files:
        Path(f).write_text("x")

    catalog = {
        "PLAN": {"sgio": "SGIO_P1"},
        "PLAN_001": {"sgio": "SGIO_P2"},
    }
    monkeypatch.setattr("backend.core.database.buscar_por_columna", lambda _keys, _col: catalog)

    engine = RenamerEngine("{sgio}_{seq}{ext}", 1, sequence_mode="filename")
    plan = resolve_rename_plan(files, engine, key_column="nis")

    assert plan.items == [
        (files[0], "SGIO_P2_1.jpg", True),
        (files[1], "SGIO_P1_002.jpg", True),
    ]
    assert plan.codigos_manuales == {"PLAN_001.jpg": "PLAN_001", "PLAN_002.jpg": "PLAN"}
    assert plan.file_seqs == {"PLAN_001.jpg": "1", "PLAN_002.jpg": "002"}


def test_resolve_rename_plan_lote_con_grupos_y_lookup(monkeypatch, tmp_path) -> None:
    files = [str(tmp_path / n) for n in ("L1_1.jpg", "L2_5.jpg")]
    catalog = {"L1": {"sgio": "SGIO_A"}, "L2_5": {"sgio": "SGIO_B"}}

    engine = RenamerEngine("{sgio}_{seq}{ext}", 1, sequence_mode="record")
    plan = resolve_rename_plan(files, engine, lookup_batch=lambda _keys: catalog)

    assert plan.items == [
        (files[0], "SGIO_A_001.jpg", True),
        (files[1], "SGIO_B_001.jpg", True),
    ]
    assert plan.codigos_manuales == {"L1_1.jpg": "L1", "L2_5.jpg": "L2_5"}
    assert plan.file_seqs == {"L1_1.jpg": "1", "L2_5.jpg": "1"}
    assert plan.sequence_groups == {"L1_1.jpg": "l1", "L2_5.jpg": "l2_5"}
    assert plan.lookup is not None
    assert plan.lookup("L1") == {"sgio": "SGIO_A"}


def test_resolve_rename_plan_posicional_con_offset(monkeypatch, tmp_path) -> None:
    files = [str(tmp_path / n) for n in ("X_1.jpg", "X_2.jpg", "X_3.jpg")]
    rows = [{"sgio": "SGIO_A"}, {"sgio": "SGIO_B"}, {"sgio": "SGIO_C"}]
    calls: list[tuple[int, int]] = []

    def fake_obtener_todos(limit=None, offset=0):
        calls.append((limit, offset))
        return rows[offset : offset + limit] if limit is not None else rows

    monkeypatch.setattr("backend.core.database.obtener_todos", fake_obtener_todos)

    engine = RenamerEngine("{sgio}_{seq}{ext}", 1, sequence_mode="global")
    plan = resolve_rename_plan(files[1:], engine, use_column_rename=True, global_offset=1)

    assert plan.items == [
        (files[1], "SGIO_B_001.jpg", True),
        (files[2], "SGIO_C_002.jpg", True),
    ]
    assert calls == [(2, 1)]


def test_parity_preview_vs_process_key_column(monkeypatch, tmp_path) -> None:
    names = ("PLAN_001.jpg", "PLAN_002.jpg", "SOLO_7.jpg")
    files = [str(tmp_path / n) for n in names]
    for f in files:
        Path(f).write_text("x")

    catalog = {
        "PLAN": {"sgio": "SGIO_P1"},
        "PLAN_001": {"sgio": "SGIO_P2"},
        "SOLO": {"sgio": "SGIO_S"},
    }
    monkeypatch.setattr("backend.core.database.buscar_por_columna", lambda _keys, _col: catalog)
    monkeypatch.setattr("backend.core.database.buscar_lote_por_codigos", lambda _keys: {})
    monkeypatch.setattr("backend.core.config_fields.get_field_names", lambda: ["nis", "sgio"])

    patron = "{sgio}_{seq}{ext}"
    preview_result = conversion.preview({
        "files": files,
        "patron": patron,
        "secuencia": 1,
        "key_column": "nis",
        "use_filename_seq": True,
    })
    engine = RenamerEngine(patron, 1, sequence_mode="filename")
    tasks = conversion._prepare_chunk_tasks(
        files,
        destino=str(tmp_path / "out"),
        engine=engine,
        conversion_enabled=False,
        ext_dest=None,
        lookup_fn=lambda _keys: {},
        key_column="nis",
    )

    preview_names = [item["nuevo"] for item in preview_result["preview"]]
    process_names = [task[1].name for task in tasks]
    assert preview_names == process_names
    assert preview_names == ["SGIO_P2_1.jpg", "SGIO_P1_002.jpg", "SGIO_S_7.jpg"]


def test_parity_preview_vs_process_lote_record(monkeypatch, tmp_path) -> None:
    names = ("R1_1.jpg", "R1_2.jpg", "ZZZ_9.jpg")
    files = [str(tmp_path / n) for n in names]
    for f in files:
        Path(f).write_text("x")

    catalog = {"R1": {"sgio": "SGIO_A"}}
    monkeypatch.setattr("backend.core.database.buscar_lote_por_codigos", lambda _keys: catalog)
    monkeypatch.setattr("backend.core.config_fields.get_field_names", lambda: ["nis", "sgio"])

    patron = "{sgio}_{seq}{ext}"
    preview_result = conversion.preview({
        "files": files,
        "patron": patron,
        "secuencia": 1,
        "key_column": "",
        "sequence_mode": "record",
        "use_filename_seq": False,
    })
    engine = RenamerEngine(patron, 1, sequence_mode="record")
    tasks = conversion._prepare_chunk_tasks(
        files,
        destino=str(tmp_path / "out"),
        engine=engine,
        conversion_enabled=False,
        ext_dest=None,
        lookup_fn=lambda _keys: catalog,
    )

    preview_names = [item["nuevo"] for item in preview_result["preview"]]
    process_names = [task[1].name for task in tasks]
    assert preview_names == process_names
    assert preview_names == ["SGIO_A_001.jpg", "SGIO_A_002.jpg", "ZZZ_9.jpg"]
    assert [item["en_bd"] for item in preview_result["preview"]] == [True, True, False]


def test_parity_preview_vs_process_posicional_entre_chunks(monkeypatch, tmp_path) -> None:
    names = ("4210502 (1).jpg", "4210502 (2).jpg", "4210502 (3).jpg")
    files = [str(tmp_path / n) for n in names]
    for f in files:
        Path(f).write_text("x")

    rows = [{"sgio": "SGIO_A"}, {"sgio": "SGIO_B"}, {"sgio": "SGIO_C"}]
    monkeypatch.setattr(
        "backend.core.database.obtener_todos",
        lambda limit=None, offset=0: rows[offset : offset + limit] if limit is not None else rows,
    )
    monkeypatch.setattr("backend.core.config_fields.get_field_names", lambda: ["nis", "sgio"])

    patron = "{sgio}_{seq}{ext}"
    preview_result = conversion.preview({
        "files": files,
        "patron": patron,
        "secuencia": 1,
        "use_column_rename": True,
        "sequence_mode": "global",
        "use_filename_seq": True,
    })
    engine = RenamerEngine(patron, 1, sequence_mode="global")
    chunk0 = conversion._prepare_chunk_tasks(
        files[:2],
        destino=str(tmp_path / "out"),
        engine=engine,
        conversion_enabled=False,
        ext_dest=None,
        lookup_fn=lambda _keys: {},
        use_column_rename=True,
        global_offset=0,
    )
    chunk1 = conversion._prepare_chunk_tasks(
        files[2:],
        destino=str(tmp_path / "out"),
        engine=engine,
        conversion_enabled=False,
        ext_dest=None,
        lookup_fn=lambda _keys: {},
        use_column_rename=True,
        global_offset=2,
    )

    process_names = [task[1].name for task in chunk0 + chunk1]
    preview_names = [item["nuevo"] for item in preview_result["preview"]]
    assert process_names == preview_names
    assert preview_names == ["SGIO_A_001.jpg", "SGIO_B_002.jpg", "SGIO_C_003.jpg"]
