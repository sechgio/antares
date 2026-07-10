"""Dimensiones A4 alineadas al documento de referencia SEDAPAL/CONCUSA."""

from __future__ import annotations

PAGE_MARGIN_CM = 0.8
PAGE_WIDTH_CM = 21.0
PAGE_HEIGHT_CM = 29.7
TABLE_WIDTH_CM = round(PAGE_WIDTH_CM - 2 * PAGE_MARGIN_CM, 2)  # 19.4 cm
CONTENT_HEIGHT_CM = round(PAGE_HEIGHT_CM - 2 * PAGE_MARGIN_CM, 2)  # 28.1 cm

# Encabezado: logos a los lados (rowspan 2), título + cuadrante en el centro.
HEADER_TITLE_HEIGHT_CM = 1.5
HEADER_INFO_HEIGHT_CM = 1.3
HEADER_TOTAL_HEIGHT_CM = round(HEADER_TITLE_HEIGHT_CM + HEADER_INFO_HEIGHT_CM, 2)  # 2.8 cm
GAP_UNDER_HEADER_CM = 0.4
# Gutters uniformes dentro de un solo marco exterior (estética panel).
PHOTO_GAP_CM = 0.1
PHOTO_COLS = 3
PHOTO_ROWS = 2
# gap | foto | gap | foto | gap | foto | gap
PHOTO_GAP_COLS = PHOTO_COLS + 1
PHOTO_TABLE_COLS = PHOTO_COLS + PHOTO_GAP_COLS  # 7
# gap | foto | gap | foto | gap
PHOTO_GAP_ROWS = PHOTO_ROWS + 1
PHOTO_TABLE_ROWS = PHOTO_ROWS + PHOTO_GAP_ROWS  # 5
GAP_HEIGHT_CM = PHOTO_GAP_CM

# Anchos de columnas del encabezado (independientes del grid de fotos)
HEADER_LOGO_WIDTH_CM = 4.2
HEADER_TITLE_WIDTH_CM = round(TABLE_WIDTH_CM - 2 * HEADER_LOGO_WIDTH_CM, 2)  # 11.0 cm

PHOTO_WIDTH_CM = round(
    (TABLE_WIDTH_CM - PHOTO_GAP_COLS * PHOTO_GAP_CM) / PHOTO_COLS,
    2,
)  # 6.33 cm
PHOTO_HEIGHT_CM = 11.5
TABLE_HEIGHT_CM = round(
    HEADER_TOTAL_HEIGHT_CM
    + GAP_UNDER_HEADER_CM
    + PHOTO_GAP_ROWS * PHOTO_GAP_CM
    + PHOTO_ROWS * PHOTO_HEIGHT_CM,
    2,
)

LOGO_MAX_WIDTH_CM = 3.8
LOGO_MAX_HEIGHT_CM = 2.2
TITLE_FONT_PT = 11.0
INFO_FONT_PT = 9.0
BORDER_PT = 0.75

CUADRANTE_LABEL = "CUADRANTE AFECTADO:"
EMPTY_CUADRANTE_PLACEHOLDER = "—"


def layout_context() -> dict[str, float | str]:
    return {
        "page_margin_cm": PAGE_MARGIN_CM,
        "table_width_cm": TABLE_WIDTH_CM,
        "content_height_cm": CONTENT_HEIGHT_CM,
        "table_height_cm": TABLE_HEIGHT_CM,
        "header_title_height_cm": HEADER_TITLE_HEIGHT_CM,
        "header_info_height_cm": HEADER_INFO_HEIGHT_CM,
        "header_total_height_cm": HEADER_TOTAL_HEIGHT_CM,
        "header_logo_width_cm": HEADER_LOGO_WIDTH_CM,
        "header_title_width_cm": HEADER_TITLE_WIDTH_CM,
        "gap_under_header_cm": GAP_UNDER_HEADER_CM,
        "gap_height_cm": GAP_HEIGHT_CM,
        "photo_gap_cm": PHOTO_GAP_CM,
        "photo_width_cm": PHOTO_WIDTH_CM,
        "photo_height_cm": PHOTO_HEIGHT_CM,
        "logo_max_width_cm": LOGO_MAX_WIDTH_CM,
        "logo_max_height_cm": LOGO_MAX_HEIGHT_CM,
        "title_font_pt": TITLE_FONT_PT,
        "info_font_pt": INFO_FONT_PT,
        "border_pt": BORDER_PT,
        "cuadrante_label": CUADRANTE_LABEL,
        "show_cuadrante_label": True,
        "empty_cuadrante_placeholder": EMPTY_CUADRANTE_PLACEHOLDER,
    }
