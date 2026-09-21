from backend.utils.coercion import safe_int


def test_safe_int_lee_separadores_en_espanol() -> None:
    assert safe_int("1.250") == 1250
    assert safe_int("12,5") == 12
    assert safe_int("1.250,5") == 1250
    assert safe_int("-1.250") == -1250


def test_safe_int_mantiene_la_lectura_decimal_y_los_rechazos() -> None:
    assert safe_int("12.5") == 12
    assert safe_int("1.25") == 1
    assert safe_int(1250) == 1250
    assert safe_int(12.7) == 12
    assert safe_int("abc", -1) == -1
    assert safe_int("", -1) == -1
    assert safe_int(None, -1) == -1
