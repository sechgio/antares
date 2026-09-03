
from __future__ import annotations

import json
from typing import Any

import pytest

from backend.core.panel_aviso_corte.errors import InvalidPanelError
from backend.core.panel_aviso_corte.models import Panel, PanelImageRef
from backend.core.panel_aviso_corte.serialization import (
    deserialize_panel,
    serialize_panel,
)


def _ref(
    position: int,
    *,
    direccion: str = "Calle X",
    filename: str | None = None,
) -> PanelImageRef:
    return PanelImageRef(
        filename=filename or f"img_{position}.jpg",
        caption=f"IMAGEN N°{position}: {direccion}",
        position=position,
    )


def _contains_tuple(obj: Any) -> bool:
    if isinstance(obj, tuple):
        return True
    if isinstance(obj, list):
        return any(_contains_tuple(v) for v in obj)
    if isinstance(obj, dict):
        return any(_contains_tuple(v) for v in obj.values())
    return False


def _valid_payload() -> dict[str, Any]:
    return {
        "cuadrante": "CUAD-1",
        "fecha_corte": "2024-01-15",
        "motivo": "Trabajos",
        "imagenes": [],
        "source_row_index": None,
    }


class TestSerializeReturnsJsonFriendlyDict:

    def test_returns_dict_type(self) -> None:
        panel = Panel(cuadrante="CUAD-1", fecha_corte="", motivo="M")
        data = serialize_panel(panel)
        assert type(data) is dict

    def test_nested_imagenes_is_list_of_dicts(self) -> None:
        panel = Panel(
            cuadrante="CUAD-1",
            fecha_corte="2024-01-15",
            motivo="M",
            imagenes=(_ref(1), _ref(2)),
        )
        data = serialize_panel(panel)
        assert isinstance(data["imagenes"], list)
        for item in data["imagenes"]:
            assert type(item) is dict

    def test_no_tuples_anywhere_in_output(self) -> None:
        panel = Panel(
            cuadrante="CUAD-1",
            fecha_corte="2024-01-15",
            motivo="M",
            imagenes=(_ref(1), _ref(2), _ref(3), _ref(4)),
            source_row_index=3,
        )
        data = serialize_panel(panel)
        assert not _contains_tuple(data), (
            "serialize_panel no debe emitir tuples; debe ser JSON-friendly"
        )

    def test_output_is_json_dumps_compatible(self) -> None:
        panel = Panel(
            cuadrante="Cuadrante Ñandú",
            fecha_corte="2024-01-15",
            motivo="Trabajos con acentuación",
            imagenes=(_ref(1, direccion="Av. España"),),
            source_row_index=42,
        )
        data = serialize_panel(panel)
        encoded = json.dumps(data)
        assert isinstance(encoded, str)
        reloaded = json.loads(encoded)
        assert reloaded["cuadrante"] == "Cuadrante Ñandú"
        assert reloaded["imagenes"][0]["position"] == 1


class TestRoundTripFixedExamples:

    def test_round_trip_zero_images_form_mode_empty_fecha(self) -> None:
        panel = Panel(
            cuadrante="CUAD-1",
            fecha_corte="",
            motivo="Trabajos",
        )
        result = deserialize_panel(serialize_panel(panel))
        assert result == panel
        assert result.imagenes == ()
        assert result.fecha_corte == ""

    def test_round_trip_one_image(self) -> None:
        panel = Panel(
            cuadrante="CUAD-1",
            fecha_corte="2024-01-15",
            motivo="Trabajos",
            imagenes=(_ref(1, direccion="Av. Principal 123"),),
        )
        result = deserialize_panel(serialize_panel(panel))
        assert result == panel
        assert len(result.imagenes) == 1

    def test_round_trip_full_grid_four_images(self) -> None:
        panel = Panel(
            cuadrante="CUAD-FULL",
            fecha_corte="2024-12-31",
            motivo="Mantenimiento programado",
            imagenes=(
                _ref(1, direccion="Calle 1"),
                _ref(2, direccion="Calle 2"),
                _ref(3, direccion="Calle 3"),
                _ref(4, direccion="Calle 4"),
            ),
        )
        result = deserialize_panel(serialize_panel(panel))
        assert result == panel
        assert len(result.imagenes) == 4
        assert tuple(r.position for r in result.imagenes) == (1, 2, 3, 4)

    def test_round_trip_iso_fecha_with_source_row_index(self) -> None:
        panel = Panel(
            cuadrante="CUAD-7",
            fecha_corte="2024-06-15",
            motivo="Trabajos",
            imagenes=(_ref(1),),
            source_row_index=7,
        )
        result = deserialize_panel(serialize_panel(panel))
        assert result == panel
        assert result.source_row_index == 7
        assert result.fecha_corte == "2024-06-15"

    def test_round_trip_unicode_in_cuadrante_motivo_and_captions(self) -> None:
        panel = Panel(
            cuadrante="Ñuñoa — Sector 4°",
            fecha_corte="2024-01-15",
            motivo="Trabajos de mejoramiento en la red 💧 (área crítica)",
            imagenes=(
                _ref(1, direccion="Av. Gral. Velásquez 123"),
                _ref(2, direccion="Pasaje Ñirehuao s/n"),
            ),
        )
        result = deserialize_panel(serialize_panel(panel))
        assert result == panel
        assert result.cuadrante == "Ñuñoa — Sector 4°"
        assert result.motivo.endswith("(área crítica)")
        assert result.imagenes[1].caption == "IMAGEN N°2: Pasaje Ñirehuao s/n"


class TestDeserializeMissingRequiredFields:

    def test_missing_cuadrante_raises(self) -> None:
        data = _valid_payload()
        del data["cuadrante"]
        with pytest.raises(InvalidPanelError, match="cuadrante"):
            deserialize_panel(data)

    def test_missing_fecha_corte_raises(self) -> None:
        data = _valid_payload()
        del data["fecha_corte"]
        with pytest.raises(InvalidPanelError, match="fecha_corte"):
            deserialize_panel(data)

    def test_missing_motivo_raises(self) -> None:
        data = _valid_payload()
        del data["motivo"]
        with pytest.raises(InvalidPanelError, match="motivo"):
            deserialize_panel(data)

    def test_missing_imagenes_raises(self) -> None:
        data = _valid_payload()
        del data["imagenes"]
        with pytest.raises(InvalidPanelError, match="imagenes"):
            deserialize_panel(data)


class TestDeserializeInvalidImagenesType:

    @pytest.mark.parametrize(
        "bad_value",
        [
            "not a list",
            42,
            {"k": "v"},
            None,
        ],
    )
    def test_imagenes_not_list_or_tuple_raises(self, bad_value: Any) -> None:
        data = _valid_payload()
        data["imagenes"] = bad_value
        with pytest.raises(InvalidPanelError, match="imagenes"):
            deserialize_panel(data)


class TestDeserializeInvalidImageRef:

    def test_image_ref_missing_filename_raises(self) -> None:
        data = _valid_payload()
        data["imagenes"] = [{"caption": "IMAGEN N°1: Calle X", "position": 1}]
        with pytest.raises(InvalidPanelError, match="filename"):
            deserialize_panel(data)

    def test_image_ref_missing_caption_raises(self) -> None:
        data = _valid_payload()
        data["imagenes"] = [{"filename": "img_1.jpg", "position": 1}]
        with pytest.raises(InvalidPanelError, match="caption"):
            deserialize_panel(data)

    def test_image_ref_missing_position_raises(self) -> None:
        data = _valid_payload()
        data["imagenes"] = [
            {"filename": "img_1.jpg", "caption": "IMAGEN N°1: Calle X"},
        ]
        with pytest.raises(InvalidPanelError, match="position"):
            deserialize_panel(data)

    @pytest.mark.parametrize(
        "bad_position",
        [
            "1",
            1.5,
            None,
        ],
    )
    def test_image_ref_position_not_int_raises(self, bad_position: Any) -> None:
        data = _valid_payload()
        data["imagenes"] = [
            {
                "filename": "img_1.jpg",
                "caption": "IMAGEN N°1: Calle X",
                "position": bad_position,
            },
        ]
        with pytest.raises(InvalidPanelError, match="position"):
            deserialize_panel(data)

    def test_image_ref_not_a_dict_raises(self) -> None:
        data = _valid_payload()
        data["imagenes"] = ["not_a_dict"]
        with pytest.raises(InvalidPanelError):
            deserialize_panel(data)
