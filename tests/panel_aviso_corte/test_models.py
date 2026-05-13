"""Tests unitarios de invariantes de los modelos canónicos.

Cubre las invariantes I1..I6 descritas en el diseño y en el docstring de
:mod:`backend.core.panel_aviso_corte.models`. No usa Hypothesis: se trata
de casos puntuales con valores fijos.

Validates: Requirements 13.1, 13.4
"""

from __future__ import annotations

import pytest

from backend.core.panel_aviso_corte.errors import (
    InvalidMatchRuleError,
    InvalidPanelError,
)
from backend.core.panel_aviso_corte.models import (
    MAX_EXCEL_ROWS,
    MAX_IMAGE_BYTES,
    MAX_IMAGES_PER_PANEL,
    MAX_LOGO_BYTES,
    MatchRule,
    Panel,
    PanelImageRef,
)

# Helpers


def _ref(position: int, *, filename: str | None = None, direccion: str = "Calle X") -> PanelImageRef:
    return PanelImageRef(
        filename=filename or f"img_{position}.jpg",
        caption=f"IMAGEN N°{position}: {direccion}",
        position=position,
    )


# Constantes del módulo


class TestModuleConstants:
    def test_max_images_per_panel_is_four(self) -> None:
        assert MAX_IMAGES_PER_PANEL == 4

    def test_max_excel_rows_is_10_000(self) -> None:
        assert MAX_EXCEL_ROWS == 10_000

    def test_max_logo_bytes_is_5_mib(self) -> None:
        assert MAX_LOGO_BYTES == 5 * 1024 * 1024

    def test_max_image_bytes_is_15_mib(self) -> None:
        assert MAX_IMAGE_BYTES == 15 * 1024 * 1024


# PanelImageRef: caption + position (I3)


class TestPanelImageRefCaption:
    def test_valid_caption_matches_position(self) -> None:
        ref = PanelImageRef(
            filename="foto.jpg",
            caption="IMAGEN N°2: Av. Principal 123",
            position=2,
        )
        assert ref.position == 2

    def test_invalid_caption_format_missing_prefix_raises(self) -> None:
        with pytest.raises(InvalidPanelError, match="caption"):
            PanelImageRef(
                filename="foto.jpg",
                caption="Imagen 1: direccion",
                position=1,
            )

    def test_caption_with_number_above_4_is_valid(self) -> None:
        # El número de caption ya no está limitado a 1..4; es un
        # secuencial global (I3 relajado).
        ref = PanelImageRef(
            filename="foto.jpg",
            caption="IMAGEN N°5: direccion",
            position=1,
        )
        assert ref.position == 1
        assert ref.caption == "IMAGEN N°5: direccion"

    def test_caption_number_mismatched_with_position_is_valid(self) -> None:
        # Ya no se exige que el número del caption coincida con position
        # (I3 relajado: caption es secuencial global, position es 1..4).
        ref = PanelImageRef(
            filename="foto.jpg",
            caption="IMAGEN N°42: direccion",
            position=3,
        )
        assert ref.position == 3

    def test_empty_filename_raises(self) -> None:
        with pytest.raises(InvalidPanelError, match="filename"):
            PanelImageRef(
                filename="",
                caption="IMAGEN N°1: direccion",
                position=1,
            )

    @pytest.mark.parametrize("bad_pos", [0, 5, -1, 42])
    def test_position_out_of_1_to_4_raises(self, bad_pos: int) -> None:
        with pytest.raises(InvalidPanelError, match="position"):
            PanelImageRef(
                filename="foto.jpg",
                caption=f"IMAGEN N°{max(1, min(4, bad_pos))}: direccion",
                position=bad_pos,
            )


# Panel: capacidad y posiciones (I1 + I2) y fecha (I4)


class TestPanelCapacityAndPositions:
    def test_panel_with_5_images_raises(self) -> None:
        """I1: más de 4 imágenes debe lanzar InvalidPanelError."""
        refs = (*tuple(_ref(p) for p in [1, 2, 3, 4]), PanelImageRef(filename="extra.jpg", caption="IMAGEN N°4: extra", position=4))
        with pytest.raises(InvalidPanelError, match="imagenes"):
            Panel(
                cuadrante="CUAD-1",
                fecha_corte="2024-01-15",
                motivo="Trabajos",
                imagenes=refs,
            )

    def test_panel_with_repeated_positions_raises(self) -> None:
        """I2: posiciones repetidas deben lanzar."""
        refs = (_ref(1), _ref(2), _ref(2, filename="dup.jpg"))
        with pytest.raises(InvalidPanelError, match="posiciones"):
            Panel(
                cuadrante="CUAD-1",
                fecha_corte="2024-01-15",
                motivo="Trabajos",
                imagenes=refs,
            )

    def test_panel_with_0_to_4_images_is_valid(self) -> None:
        for count in range(MAX_IMAGES_PER_PANEL + 1):
            refs = tuple(_ref(p) for p in range(1, count + 1))
            panel = Panel(
                cuadrante="CUAD-1",
                fecha_corte="2024-01-15",
                motivo="Trabajos",
                imagenes=refs,
            )
            assert len(panel.imagenes) == count

    def test_panel_imagenes_must_be_tuple(self) -> None:
        # Un list con posiciones únicas debe rechazarse por tipo: la API
        # exige ``tuple`` inmutable.
        with pytest.raises(InvalidPanelError, match="imagenes"):
            Panel(
                cuadrante="CUAD-1",
                fecha_corte="2024-01-15",
                motivo="Trabajos",
                imagenes=[_ref(1), _ref(2)],  # type: ignore[arg-type]
            )

    def test_panel_imagenes_must_contain_panel_image_refs(self) -> None:
        with pytest.raises(InvalidPanelError, match=r"imagenes\[0\]"):
            Panel(
                cuadrante="CUAD-1",
                fecha_corte="2024-01-15",
                motivo="Trabajos",
                imagenes=({"filename": "x.jpg"},),  # type: ignore[arg-type]
            )


class TestPanelFechaCorte:
    def test_empty_fecha_is_accepted_form_mode(self) -> None:
        panel = Panel(
            cuadrante="CUAD-1",
            fecha_corte="",
            motivo="Trabajos",
        )
        assert panel.fecha_corte == ""

    def test_iso_date_is_accepted(self) -> None:
        panel = Panel(
            cuadrante="CUAD-1",
            fecha_corte="2024-12-31",
            motivo="Trabajos",
        )
        assert panel.fecha_corte == "2024-12-31"

    @pytest.mark.parametrize(
        "bad_date",
        [
            "31-12-2024",    # formato DD-MM-YYYY
            "2024/12/31",    # separadores distintos
            "2024-1-1",      # sin ceros a la izquierda
            "2024-13-01 ",   # espacio al final
            "2024-12-31T00:00:00",  # datetime
            "abcd-ef-gh",
            "2024",
        ],
    )
    def test_non_iso_fecha_raises(self, bad_date: str) -> None:
        """I4: fecha fuera de ISO-8601 YYYY-MM-DD debe lanzar."""
        with pytest.raises(InvalidPanelError, match="fecha_corte"):
            Panel(
                cuadrante="CUAD-1",
                fecha_corte=bad_date,
                motivo="Trabajos",
            )


class TestPanelSourceRowIndex:
    def test_none_is_accepted(self) -> None:
        panel = Panel(
            cuadrante="CUAD-1",
            fecha_corte="",
            motivo="Trabajos",
            source_row_index=None,
        )
        assert panel.source_row_index is None

    def test_non_negative_int_is_accepted(self) -> None:
        panel = Panel(
            cuadrante="CUAD-1",
            fecha_corte="",
            motivo="Trabajos",
            source_row_index=0,
        )
        assert panel.source_row_index == 0

    def test_negative_raises(self) -> None:
        with pytest.raises(InvalidPanelError, match="source_row_index"):
            Panel(
                cuadrante="CUAD-1",
                fecha_corte="",
                motivo="Trabajos",
                source_row_index=-1,
            )


# MatchRule: regex con grupo (?P<clave>...) (I6)


class TestMatchRule:
    def test_prefix_without_regex_is_valid(self) -> None:
        rule = MatchRule(key_column="CODIGO", strategy="prefix")
        assert rule.regex_pattern is None

    def test_contains_without_regex_is_valid(self) -> None:
        MatchRule(key_column="CODIGO", strategy="contains")

    def test_exact_without_regex_is_valid(self) -> None:
        MatchRule(key_column="CODIGO", strategy="exact")

    def test_regex_with_named_clave_group_is_valid(self) -> None:
        rule = MatchRule(
            key_column="CODIGO",
            strategy="regex",
            regex_pattern=r"^img_(?P<clave>[A-Za-z0-9]+)",
        )
        assert rule.regex_pattern is not None

    def test_regex_without_named_clave_group_raises(self) -> None:
        """I6: regex sin ``(?P<clave>...)`` debe lanzar."""
        with pytest.raises(InvalidMatchRuleError, match="clave"):
            MatchRule(
                key_column="CODIGO",
                strategy="regex",
                regex_pattern=r"^img_(\d+)",  # grupo anónimo
            )

    def test_regex_with_different_named_group_raises(self) -> None:
        with pytest.raises(InvalidMatchRuleError, match="clave"):
            MatchRule(
                key_column="CODIGO",
                strategy="regex",
                regex_pattern=r"^img_(?P<otro>\d+)",
            )

    def test_regex_invalid_syntax_raises(self) -> None:
        with pytest.raises(InvalidMatchRuleError, match="regex"):
            MatchRule(
                key_column="CODIGO",
                strategy="regex",
                regex_pattern=r"(?P<clave>[",  # corchete sin cerrar
            )

    def test_regex_strategy_requires_pattern(self) -> None:
        with pytest.raises(InvalidMatchRuleError, match="regex_pattern"):
            MatchRule(
                key_column="CODIGO",
                strategy="regex",
                regex_pattern=None,
            )

    def test_empty_key_column_raises(self) -> None:
        with pytest.raises(InvalidMatchRuleError, match="key_column"):
            MatchRule(key_column="", strategy="prefix")

    def test_unknown_strategy_raises(self) -> None:
        with pytest.raises(InvalidMatchRuleError, match="strategy"):
            MatchRule(
                key_column="CODIGO",
                strategy="fuzzy",  # type: ignore[arg-type]
            )


# Inmutabilidad de los dataclasses (frozen=True)


class TestFrozenDataclasses:
    def test_panel_is_frozen(self) -> None:
        panel = Panel(
            cuadrante="CUAD-1",
            fecha_corte="",
            motivo="Trabajos",
        )
        with pytest.raises(Exception):  # FrozenInstanceError
            panel.cuadrante = "otro"  # type: ignore[misc]

    def test_panel_image_ref_is_frozen(self) -> None:
        ref = _ref(1)
        with pytest.raises(Exception):  # FrozenInstanceError
            ref.position = 2  # type: ignore[misc]

    def test_match_rule_is_frozen(self) -> None:
        rule = MatchRule(key_column="CODIGO", strategy="prefix")
        with pytest.raises(Exception):  # FrozenInstanceError
            rule.strategy = "contains"  # type: ignore[misc]
