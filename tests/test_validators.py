"""Tests para utilidades de validación."""

from backend.utils.validators import es_imagen, obtener_codigo_desde_nombre, parse_filename_parts, sanitizar_nombre


class TestEsImagen:
    def test_extensiones_soportadas(self):
        assert es_imagen("foto.jpg")
        assert es_imagen("foto.jpeg")
        assert es_imagen("foto.png")
        assert es_imagen("foto.webp")
        assert es_imagen("foto.bmp")
        assert es_imagen("foto.tiff")
        assert es_imagen("foto.tif")
        assert es_imagen("foto.gif")
        assert es_imagen("foto.ico")
        assert es_imagen("foto.pdf")

    def test_no_es_imagen(self):
        assert not es_imagen("documento.txt")
        assert not es_imagen("archivo.exe")
        assert not es_imagen("sin_extension")

    def test_mayusculas_minusculas(self):
        assert es_imagen("FOTO.JPG")
        assert es_imagen("Foto.Png")


class TestSanitizarNombre:
    def test_elimina_caracteres_invalidos_windows(self):
        assert sanitizar_nombre("a<b>c:d|e*f?g/h\\i\\j") == "a_b_c_d_e_f_g_h_i_j"

    def test_colapsa_espacios(self):
        assert sanitizar_nombre("nombre   con   espacios") == "nombre con espacios"

    def test_strip_extremos(self):
        assert sanitizar_nombre("  archivo  ") == "archivo"

    def test_vacio(self):
        assert sanitizar_nombre("") == ""

    def test_sin_cambios(self):
        assert sanitizar_nombre("nombre_valido-123") == "nombre_valido-123"


class TestObtenerCodigoDesdeNombre:
    def test_stem_simple(self):
        assert obtener_codigo_desde_nombre("123.jpg") == "123"

    def test_nombre_con_puntos(self):
        assert obtener_codigo_desde_nombre("IMG.001.jpg") == "IMG.001"

    def test_ruta_completa(self):
        assert obtener_codigo_desde_nombre("C:/carpeta/archivo_01.png") == "archivo_01"


class TestParseFilenameParts:
    def test_extrae_base_y_secuencia_con_guion(self):
        assert parse_filename_parts("69466481-1.jpg") == ("69466481", "1")

    def test_extrae_base_y_secuencia_con_guion_bajo(self):
        assert parse_filename_parts("69466481_2.jpg") == ("69466481", "2")
