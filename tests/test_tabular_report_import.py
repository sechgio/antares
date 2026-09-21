from backend.core.tabular_report_import import (
    normalize_tabular_header,
    normalize_tabular_key,
    parse_csv_rows,
)


def test_normalize_tabular_header_preserves_domain_quote_policy() -> None:
    assert normalize_tabular_header('Valv Cond 2"', strip_quotes=True) == "valvcond2"
    assert normalize_tabular_header('Valv Cond 2"', strip_quotes=False) == 'valvcond2"'


def test_normalize_tabular_key_uses_mapping_then_falls_back_to_snake_case() -> None:
    mapping = {"fechaejecucion": "fecha_ejecucion"}

    def normalize_header(value: str) -> str:
        return normalize_tabular_header(value, strip_quotes=True)

    assert normalize_tabular_key("Fecha de Ejecución", mapping, normalize_header) == "fecha_ejecucion"
    assert normalize_tabular_key("Dato Libre", mapping, normalize_header) == "dato_libre"


def test_parse_csv_rows_lee_cp1252_antes_que_latin1() -> None:
    # En cp1252 0x97 y 0x92 son raya y comilla tipográfica; latin-1 las lee como control.
    content = "Observacion;Detalle\nZona 2 \u2014 alta\u2019 ok;listo\n".encode("cp1252")

    rows = parse_csv_rows(content, column_mapping={}, normalize_key=lambda value: str(value))

    assert rows[0]["Observacion"] == "Zona 2 \u2014 alta\u2019 ok"
