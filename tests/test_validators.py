"""Tests para utilidades de validación."""

from backend.utils.validators import (
    es_imagen,
    is_safe_user_path,
    obtener_codigo_desde_nombre,
    parse_filename_parts,
    sanitizar_nombre,
)


class TestEsImagen:
    def test_extensiones_soportadas(self) -> None:
        assert es_imagen("foto.jpg")
        assert es_imagen("foto.jpeg")
        assert es_imagen("foto.png")
        assert es_imagen("foto.webp")
        assert es_imagen("foto.bmp")
        assert es_imagen("foto.tiff")
        assert es_imagen("foto.tif")
        assert es_imagen("foto.gif")
        assert es_imagen("foto.ico")

    def test_no_es_imagen(self) -> None:
        assert not es_imagen("documento.txt")
        assert not es_imagen("archivo.exe")
        assert not es_imagen("sin_extension")
        assert not es_imagen("foto.pdf")

    def test_mayusculas_minusculas(self) -> None:
        assert es_imagen("FOTO.JPG")
        assert es_imagen("Foto.Png")


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
