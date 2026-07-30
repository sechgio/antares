"""Tests para utilidades de validación."""

from backend.utils.validators import (
    is_path_like_key,
    is_safe_user_path,
    obtener_codigo_desde_nombre,
    parse_filename_parts,
    sanitizar_nombre,
)


class TestSanitizarNombre:
    def test_elimina_caracteres_invalidos_windows(self) -> None:
        assert sanitizar_nombre("a<b>c:d|e*f?g/h\\i\\j") == "a_b_c_d_e_f_g_h_i_j"

    def test_colapsa_espacios(self) -> None:
        assert sanitizar_nombre("nombre   con   espacios") == "nombre con espacios"

    def test_strip_extremos(self) -> None:
        assert sanitizar_nombre("  archivo  ") == "archivo"

    def test_vacio(self) -> None:
        assert sanitizar_nombre("") == ""

    def test_sin_cambios(self) -> None:
        assert sanitizar_nombre("nombre_valido-123") == "nombre_valido-123"


class TestObtenerCodigoDesdeNombre:
    def test_stem_simple(self) -> None:
        assert obtener_codigo_desde_nombre("123.jpg") == "123"

    def test_nombre_con_puntos(self) -> None:
        assert obtener_codigo_desde_nombre("IMG.001.jpg") == "IMG.001"

    def test_ruta_completa(self) -> None:
        assert obtener_codigo_desde_nombre("C:/carpeta/archivo_01.png") == "archivo_01"


class TestParseFilenameParts:
    def test_extrae_base_y_secuencia_con_guion(self) -> None:
        assert parse_filename_parts("69466481-1.jpg") == ("69466481", "1")

    def test_extrae_base_y_secuencia_con_guion_bajo(self) -> None:
        assert parse_filename_parts("69466481_2.jpg") == ("69466481", "2")

    def test_extrae_base_y_secuencia_del_sufijo_parentetico_de_windows(self) -> None:
        assert parse_filename_parts("4210502 (3).jpeg") == ("4210502", "3")

    def test_no_trata_anio_como_secuencia(self) -> None:
        """Trailing _2024 / -2019 are year-like, not sequence numbers."""
        assert parse_filename_parts("photo_2024.jpg") == ("photo_2024", "1")
        assert parse_filename_parts("vacation-2019.png") == ("vacation-2019", "1")


class TestSafeUserPath:
    def test_rechaza_traversal_y_bytes_nulos(self) -> None:
        assert not is_safe_user_path("../secret.txt")
        assert not is_safe_user_path("..\\secret.txt")
        assert not is_safe_user_path("folder/..")
        assert not is_safe_user_path("folder\\..")
        assert not is_safe_user_path("..")
        assert not is_safe_user_path(".")
        assert not is_safe_user_path("safe\x00name")

    def test_rechaza_traversal_codificado(self) -> None:
        assert not is_safe_user_path("%2e%2e/secret.txt")
        assert not is_safe_user_path("%252e%252e/secret.txt")

    def test_acepta_rutas_normales(self) -> None:
        assert is_safe_user_path("C:/Users/demo/file.pdf")
        assert is_safe_user_path("folder/subfolder/file.pdf")


class TestIsPathLikeKey:
    def test_keys_snake_case(self) -> None:
        assert is_path_like_key("path")
        assert is_path_like_key("output_path")
        assert is_path_like_key("input_dir")
        assert is_path_like_key("image_paths")

    def test_keys_camel_case(self) -> None:
        # Regression: camelCase path keys must be screened too (B3).
        assert is_path_like_key("excelPath")
        assert is_path_like_key("outputDir")
        assert is_path_like_key("filePath")
        assert is_path_like_key("inputDir")

    def test_keys_mixed_case(self) -> None:
        assert is_path_like_key("output_pathFile")
        assert is_path_like_key("output_path_File")
        assert is_path_like_key("_pathFile")

    def test_keys_no_path(self) -> None:
        assert not is_path_like_key("rowIndex")
        assert not is_path_like_key("formato")
        assert not is_path_like_key("locale")
        assert not is_path_like_key("max_remaining")
