import pytest

from backend.core.agent.questions import validate


def _question(**extra):
    return {"id": "q1", "prompt": "¿Qué formato prefieres?", **extra}


def test_validate_accepts_legacy_string_options():
    items = validate({"questions": [_question(options=["A4", "Carta"])]})
    assert items[0]["options"] == ["A4", "Carta"]
    assert "multiSelect" not in items[0]


def test_validate_normalizes_option_objects_with_descriptions():
    items = validate({"questions": [_question(
        header="Formato",
        multiSelect=True,
        options=[{"label": "PDF", "description": "Listo para imprimir"}, {"label": "Excel"}],
    )]})
    question = items[0]
    assert question["header"] == "Formato"
    assert question["multiSelect"] is True
    assert question["options"] == [{"label": "PDF", "description": "Listo para imprimir"}, {"label": "Excel"}]


def test_validate_drops_empty_description_and_false_multiselect():
    items = validate({"questions": [_question(multiSelect=False, options=[{"label": "PDF", "description": ""}])]})
    assert "multiSelect" not in items[0]
    assert items[0]["options"] == [{"label": "PDF"}]


@pytest.mark.parametrize("options", [
    [{"description": "sin etiqueta"}],
    [{"label": ""}],
    [{"label": "x" * 201}],
    [{"label": "PDF", "description": "x" * 301}],
    [42],
    ["x" * 201],
])
def test_validate_rejects_invalid_options(options):
    with pytest.raises(ValueError, match=r"Opciones de pregunta inválidas|Descripción de opción inválida"):
        validate({"questions": [_question(options=options)]})


@pytest.mark.parametrize("header", [41 * "x", 42])
def test_validate_rejects_invalid_headers(header):
    with pytest.raises(ValueError, match="Encabezado"):
        validate({"questions": [_question(header=header)]})


def test_validate_rejects_non_boolean_multiselect():
    with pytest.raises(ValueError, match="multiSelect"):
        validate({"questions": [_question(multiSelect="sí")]})
