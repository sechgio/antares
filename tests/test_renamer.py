"""Tests para el motor de renombrado automático.

Prove-It: El bug reportado era que {codigo}_{nombre}{ext} generaba
1_1_1_1.jpg en lugar de 1_2454514245.jpg cuando la BD tenía
nombre=2454514245 para codigo=1.
"""

from pathlib import Path

from backend.core.renamer import RenamerEngine


class TestRenamerEngine:
    """Pruebas para RenamerEngine.aplicar y preview_lote."""

    def test_aplicar_con_datos_completos(self, monkeypatch, tmp_path) -> None:
        """Patrón {codigo}_{nombre}{ext} con datos en BD → nombre correcto."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        engine = RenamerEngine("{codigo}_{nombre}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="1", datos_bd={"codigo": "1", "nombre": "2454514245"})

        assert resultado == "1_2454514245.jpg"

    def test_aplicar_fallback_codigo_para_campo_principal(self, monkeypatch, tmp_path) -> None:
        """Si faltan campos secundarios, elimina separadores sobrantes."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        engine = RenamerEngine("{codigo}_{nombre}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="1")

        assert resultado == "1.jpg"

    def test_aplicar_otros_campos_vacios_si_no_estan_en_bd(self, monkeypatch, tmp_path) -> None:
        """Campos distintos al primero quedan vacíos si no hay BD."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        engine = RenamerEngine("{codigo}_{nombre}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="1", datos_bd={"codigo": "1"})

        assert resultado == "1.jpg"

    def test_aplicar_no_propaga_stem_como_dato(self, monkeypatch, tmp_path) -> None:
        """Bugfix: el stem del archivo NO debe usarse como fallback para campos secundarios.

        Antes del fix, si el archivo se llamaba '1_1.jpg' y no había BD,
        el nombre se convertía en '1_1_1_1.jpg' porque ruta.stem era el fallback.
        """
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        engine = RenamerEngine("{codigo}_{nombre}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "1_1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="1")

        # El código es "1", nombre no está en BD → vacío → "1.jpg"
        assert resultado == "1.jpg"
        assert "1_1_1_1" not in resultado

    def test_limpia_separadores_repetidos_al_faltar_datos(self, monkeypatch, tmp_path) -> None:
        """Los campos vacíos no deben dejar guiones o espacios colgando."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre", "categoria"],
        )

        engine = RenamerEngine("{codigo} - {nombre} - {categoria}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="1", datos_bd={"codigo": "1"})

        assert resultado == "1.jpg"

    def test_secuencia_autoincremental(self, monkeypatch, tmp_path) -> None:
        """Cada llamada a aplicar incrementa {seq}."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo"],
        )

        engine = RenamerEngine("img_{seq}{ext}", secuencia_inicial=5)
        archivo = tmp_path / "a.jpg"
        archivo.write_text("dummy")

        assert engine.aplicar(archivo) == "img_005.jpg"
        assert engine.aplicar(archivo) == "img_006.jpg"
        assert engine.aplicar(archivo) == "img_007.jpg"

    def test_ext_mantiene_extension_original(self, monkeypatch, tmp_path) -> None:
        """{ext} usa la extensión del archivo origen."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo"],
        )

        engine = RenamerEngine("{codigo}{ext}", secuencia_inicial=1)

        jpg = tmp_path / "a.jpg"
        png = tmp_path / "b.png"
        jpg.write_text("dummy")
        png.write_text("dummy")

        assert engine.aplicar(jpg, codigo_manual="X") == "X.jpg"
        assert engine.aplicar(png, codigo_manual="Y") == "Y.png"

    def test_sanitiza_nombre(self, monkeypatch, tmp_path) -> None:
        """Elimina caracteres inválidos del resultado final."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        engine = RenamerEngine("{nombre}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "a.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="A", datos_bd={"codigo": "A", "nombre": "prod<1>"})

        assert "<" not in resultado
        assert ">" not in resultado
        assert resultado == "prod_1_.jpg"

    def test_preview_lote_no_mutua_secuencia(self, monkeypatch, tmp_path) -> None:
        """preview_lote no debe cambiar el contador interno de secuencia."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo"],
        )

        engine = RenamerEngine("{seq}{ext}", secuencia_inicial=10)
        a = tmp_path / "a.jpg"
        b = tmp_path / "b.jpg"
        a.write_text("d")
        b.write_text("d")

        previews = engine.preview_lote([a, b], lookup_fn=lambda c: None)

        assert len(previews) == 2
        assert engine.secuencia == 10  # No cambió
        # La primera llamada real debe seguir desde 10
        assert engine.aplicar(a, codigo_manual="x") == "010.jpg"

    def test_patron_por_defecto(self, monkeypatch, tmp_path) -> None:
        """Sin patrón explícito usa los dos primeros campos."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre", "categoria"],
        )

        engine = RenamerEngine(patron=None, secuencia_inicial=1)
        archivo = tmp_path / "a.jpg"
        archivo.write_text("dummy")

        assert engine.patron == "{codigo}_{nombre}{ext}"

    def test_patron_por_defecto_sin_campos_usa_secuencia(self, monkeypatch, tmp_path) -> None:
        """Sin campos configurados usa un patrón secuencial simple."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            list,
        )

        engine = RenamerEngine(patron=None, secuencia_inicial=1)
        archivo = tmp_path / "a.jpg"
        archivo.write_text("dummy")

        assert engine.patron == "img_{seq}{ext}"
        assert engine.aplicar(archivo) == "img_001.jpg"

    def test_sep_placeholder_usa_separador_configurado(self, monkeypatch, tmp_path) -> None:
        """{sep} se sustituye por el separador configurado (por defecto _)."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["sgio", "nombre"],
        )

        engine = RenamerEngine("{sgio}{sep}{nombre}{ext}", secuencia_inicial=1, separador="_")
        archivo = tmp_path / "1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(
            archivo,
            codigo_manual="1",
            datos_bd={"sgio": "454654001", "nombre": "producto"},
        )

        assert resultado == "454654001_producto.jpg"

    def test_sep_placeholder_guion_medio(self, monkeypatch, tmp_path) -> None:
        """{sep} respeta un separador distinto al predeterminado."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        engine = RenamerEngine("{codigo}{sep}{nombre}{ext}", secuencia_inicial=1, separador="-")
        archivo = tmp_path / "1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(
            archivo,
            codigo_manual="A",
            datos_bd={"codigo": "A", "nombre": "foto"},
        )

        assert resultado == "A-foto.jpg"

    def test_secuencia_por_fila_es_independiente_e_ignora_el_sufijo(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["nis", "sgio"])
        engine = RenamerEngine("{sgio}_{seq}{ext}", sequence_mode="record")
        archivo = tmp_path / "foto.jpg"
        archivo.write_text("x")

        fila_a = {"nis": "4210502", "sgio": "69841274"}
        fila_b = {"nis": "4210544", "sgio": "69841278"}

        assert engine.aplicar(archivo, datos_bd=fila_a, file_seq="7", sequence_group="4210502") == "69841274_001.jpg"
        assert engine.aplicar(archivo, datos_bd=fila_b, file_seq="9", sequence_group="4210544") == "69841278_001.jpg"
        assert engine.aplicar(archivo, datos_bd=fila_a, file_seq="1", sequence_group="4210502") == "69841274_002.jpg"

    def test_preserve_original_name_sanitiza_caracteres_invalidos(self) -> None:
        """El nombre conservado aplica la misma sanitización que aplicar()."""
        assert RenamerEngine._preserve_original_name(Path("bad<>name.jpg")) == "bad__name.jpg"

    def test_preview_lote_record_sin_match_sanitiza_nombre(self, monkeypatch, tmp_path) -> None:
        """Sin coincidencia en BD, modo record conserva el nombre original sanitizado."""
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo"])
        engine = RenamerEngine("{codigo}{ext}", sequence_mode="record")
        archivo = tmp_path / "  spaced name  .jpg"
        archivo.write_text("x")

        preview = engine.preview_lote([archivo], lookup_fn=lambda _code: None)

        assert preview == [(str(archivo), "spaced name.jpg", False)]

    def test_preview_lote_mapeo_parcial_no_consume_contador_por_fila(self, monkeypatch, tmp_path) -> None:
        """Mapeo parcial conserva original en unmapped (paridad con process) y no gasta seq."""
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["nis", "sgio"])
        engine = RenamerEngine("{sgio}_{seq}{ext}", sequence_mode="record")
        mapped = tmp_path / "mapped.jpg"
        con_datos = tmp_path / "a.jpg"
        sin_datos = tmp_path / "unmapped.jpg"
        for archivo in (mapped, con_datos, sin_datos):
            archivo.write_text("x")
        fila = {"nis": "4210502", "sgio": "69841274"}

        preview = engine.preview_lote(
            [mapped, con_datos, sin_datos],
            lookup_fn=lambda code: fila if code != "unmapped" else None,
            codigos_manuales={
                "mapped.jpg": "mapped",
                "a.jpg": "a",
                "unmapped.jpg": "unmapped",
            },
            file_mapping={"mapped.jpg": "custom_name"},
            sequence_groups={"a.jpg": "4210502"},
        )

        # Process keeps original name when mapping is active and file is unmapped.
        assert [item[1] for item in preview] == [
            "custom_name.jpg",
            "a.jpg",
            "unmapped.jpg",
        ]
        assert [item[2] for item in preview] == [True, False, False]
        # Catalog rename outside mapping mode still works and starts seq at 001.
        assert engine.aplicar(con_datos, datos_bd=fila, sequence_group="4210502") == "69841274_001.jpg"

    def test_preview_lote_restaura_contador_por_fila(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["nis", "sgio"])
        engine = RenamerEngine("{sgio}_{seq}{ext}", sequence_mode="record")
        a = tmp_path / "a.jpg"
        b = tmp_path / "b.jpg"
        a.write_text("x")
        b.write_text("x")
        fila = {"nis": "4210502", "sgio": "69841274"}

        preview = engine.preview_lote(
            [a, b],
            lookup_fn=lambda _code: fila,
            sequence_groups={"a.jpg": "4210502", "b.jpg": "4210502"},
        )

        assert [item[1] for item in preview] == ["69841274_001.jpg", "69841274_002.jpg"]
        assert engine.aplicar(a, datos_bd=fila, sequence_group="4210502") == "69841274_001.jpg"
