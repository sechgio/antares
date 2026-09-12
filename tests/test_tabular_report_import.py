from backend.core.tabular_report_import import normalize_tabular_header, normalize_tabular_key


def test_normalize_tabular_header_preserves_domain_quote_policy() -> None:
    assert normalize_tabular_header('Valv Cond 2"', strip_quotes=True) == "valvcond2"
    assert normalize_tabular_header('Valv Cond 2"', strip_quotes=False) == 'valvcond2"'


def test_normalize_tabular_key_uses_mapping_then_falls_back_to_snake_case() -> None:
    mapping = {"fechaejecucion": "fecha_ejecucion"}

    def normalize_header(value: str) -> str:
        return normalize_tabular_header(value, strip_quotes=True)

    assert normalize_tabular_key("Fecha de Ejecución", mapping, normalize_header) == "fecha_ejecucion"
    assert normalize_tabular_key("Dato Libre", mapping, normalize_header) == "dato_libre"
