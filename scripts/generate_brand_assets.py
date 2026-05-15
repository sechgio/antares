#!/usr/bin/env python3
"""
Regenera todos los assets de marca de ANTARES desde los maestros en antares/.

Maestros:
  antares/favicon1.png  -> logo oscuro
  antares/favicon2.png  -> logo claro

Genera:
  - Monograma cuadrado SVG vectorial puro (icon-mark*.svg)
  - Logos horizontales SVG con PNGs embebidos (logo*.svg)
  - Favicons y iconos de app (.ico, .icns, .png multi-tamaño)

Limpia assets antiguos incorrectos.
"""

from __future__ import annotations

import base64
import io
import shutil
import struct
from pathlib import Path

import cairosvg
from PIL import Image

# ── Rutas ──────────────────────────────────────────────────────────────────
PROJECT = Path(__file__).resolve().parent.parent
ANTARES = PROJECT / "antares"
PUBLIC = PROJECT / "frontend" / "public"
ASSETS = PROJECT / "assets"
ICONS_PNG = ASSETS / "icons" / "png"
ICONS_MAC = ASSETS / "icons" / "mac"
ICONS_WIN = ASSETS / "icons" / "win"

# ── Paleta de marca extraída de los maestros ───────────────────────────────
RED = "#F83030"
DARK_BG = "#181818"
LIGHT_BG = "#F8F8F8"

# ── Configuración ──────────────────────────────────────────────────────────
LOGO_TARGET_HEIGHT = 512          # altura del logo embebido en SVG
MONOGRAM_CANVAS = 1024            # lienzo del monograma
CORNER_RADIUS = int(MONOGRAM_CANVAS * 0.22)
FONT_SIZE = int(MONOGRAM_CANVAS * 0.72)
FONT_Y = int(MONOGRAM_CANVAS * 0.78)

ICON_PNG_SIZE = 512
ICO_SIZES = [256, 128, 96, 64, 48, 32, 24, 16]
FAVICON_PNG_SIZES = [16, 32, 48, 57, 72, 96, 120, 128, 144, 152, 180, 192, 228]
ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]


# ── Utilidades ─────────────────────────────────────────────────────────────
def img_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def load_and_trim(path: Path) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    alpha = img.split()[-1]
    bbox = alpha.getbbox()
    if bbox is None:
        return img
    return img.crop(bbox)


def resize_to_height(img: Image.Image, height: int) -> Image.Image:
    w, h = img.size
    scale = height / h
    new_w = max(1, int(round(w * scale)))
    return img.resize((new_w, height), Image.Resampling.LANCZOS)


# ── SVG Monograma (vectorial puro) ─────────────────────────────────────────
def monogram_svg(bg: str, fg: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {MONOGRAM_CANVAS} {MONOGRAM_CANVAS}" '
        f'width="{MONOGRAM_CANVAS}" height="{MONOGRAM_CANVAS}" '
        f'role="img" aria-label="ANTARES app icon">\n'
        f'  <rect x="0" y="0" width="{MONOGRAM_CANVAS}" height="{MONOGRAM_CANVAS}" '
        f'rx="{CORNER_RADIUS}" ry="{CORNER_RADIUS}" fill="{bg}"/>\n'
        f'  <text x="{MONOGRAM_CANVAS // 2}" y="{FONT_Y}" '
        f'font-family="Arial, Helvetica, sans-serif" '
        f'font-size="{FONT_SIZE}" font-weight="bold" '
        f'text-anchor="middle" dominant-baseline="middle" fill="{fg}">A</text>\n'
        f'</svg>\n'
    )


def write_monogram_variants() -> Image.Image:
    """Genera los 3 SVGs del monograma y devuelve el PNG maestro oscuro."""
    print("[1/6] Generando monogramas SVG vectoriales puros...")

    svg_dark = monogram_svg(DARK_BG, RED)
    svg_light = monogram_svg(LIGHT_BG, RED)

    (PUBLIC / "icon-mark.svg").write_text(svg_dark, encoding="utf-8")
    (PUBLIC / "icon-mark-light.svg").write_text(svg_light, encoding="utf-8")
    (PUBLIC / "icon-mark-dark.svg").write_text(svg_dark, encoding="utf-8")
    print("      icon-mark.svg, icon-mark-light.svg, icon-mark-dark.svg")

    # Renderizar PNG maestro 1024x1024 desde el SVG oscuro
    png_bytes = cairosvg.svg2png(bytestring=svg_dark.encode(),
                                  output_width=MONOGRAM_CANVAS,
                                  output_height=MONOGRAM_CANVAS)
    master = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    return master


# ── SVGs de logo horizontal ────────────────────────────────────────────────
def write_logo_svgs(light_img: Image.Image, dark_img: Image.Image):
    print("[2/6] Generando logos horizontales SVG...")

    b64_light = img_to_b64(light_img)
    b64_dark = img_to_b64(dark_img)
    w, h = light_img.size

    # Unificado con switch por prefers-color-scheme
    svg_combined = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}" role="img" aria-label="ANTARES logo">\n'
        f'  <style>\n'
        f'    .antares-light {{ display: block; }}\n'
        f'    .antares-dark  {{ display: none; }}\n'
        f'    @media (prefers-color-scheme: dark) {{\n'
        f'      .antares-light {{ display: none; }}\n'
        f'      .antares-dark  {{ display: block; }}\n'
        f'    }}\n'
        f'  </style>\n'
        f'  <image class="antares-light" href="data:image/png;base64,{b64_light}" '
        f'width="{w}" height="{h}"/>\n'
        f'  <image class="antares-dark"  href="data:image/png;base64,{b64_dark}"  '
        f'width="{w}" height="{h}"/>\n'
        f'</svg>\n'
    )

    svg_light_only = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}" role="img" aria-label="ANTARES logo">\n'
        f'  <image href="data:image/png;base64,{b64_light}" '
        f'width="{w}" height="{h}"/>\n'
        f'</svg>\n'
    )

    svg_dark_only = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}" role="img" aria-label="ANTARES logo">\n'
        f'  <image href="data:image/png;base64,{b64_dark}" '
        f'width="{w}" height="{h}"/>\n'
        f'</svg>\n'
    )

    (PUBLIC / "logo.svg").write_text(svg_combined, encoding="utf-8")
    (PUBLIC / "logo-light.svg").write_text(svg_light_only, encoding="utf-8")
    (PUBLIC / "logo-dark.svg").write_text(svg_dark_only, encoding="utf-8")
    (ASSETS / "logo.svg").write_text(svg_combined, encoding="utf-8")
    print("      logo.svg, logo-light.svg, logo-dark.svg -> public/ + assets/")


# ── Rasteres del monograma ─────────────────────────────────────────────────
def write_monogram_rasters(master: Image.Image):
    print("[3/6] Generando rasteres del monograma...")

    # Icono base 512x512
    icon_512 = master.resize((ICON_PNG_SIZE, ICON_PNG_SIZE), Image.Resampling.LANCZOS)
    icon_512.save(PUBLIC / "icon.png", format="PNG", optimize=True)
    icon_512.save(ASSETS / "icon.png", format="PNG", optimize=True)
    print(f"      icon.png ({ICON_PNG_SIZE}x{ICON_PNG_SIZE})")

    # Favicons PNG individuales
    for size in FAVICON_PNG_SIZES:
        out = master.resize((size, size), Image.Resampling.LANCZOS)
        out.save(PUBLIC / f"favicon-{size}.png", format="PNG", optimize=True)
    print(f"      favicon-[{min(FAVICON_PNG_SIZES)}-{max(FAVICON_PNG_SIZES)}].png")


# ── .ico ───────────────────────────────────────────────────────────────────
def write_ico(master: Image.Image):
    print("[4/6] Generando .ico multi-resolución...")

    # Pillow genera automáticamente las sub-imágenes si le pasamos sizes
    ico_sizes = [(s, s) for s in ICO_SIZES]
    master.save(PUBLIC / "favicon.ico", format="ICO", sizes=ico_sizes)
    master.save(ASSETS / "icon.ico", format="ICO", sizes=ico_sizes)
    print(f"      favicon.ico + assets/icon.ico ({', '.join(map(str, ICO_SIZES))})")


# ── .icns ──────────────────────────────────────────────────────────────────
def build_icns(png_map: dict[int, bytes], out_path: Path):
    """Empaqueta PNGs en un archivo .icns (macOS icon format)."""
    # Mapeo tamaño -> tipo de chunk (PNG-based modern ICNS)
    size_type = {
        16: b'icp4',
        32: b'icp5',
        64: b'icp6',
        128: b'ic07',
        256: b'ic08',
        512: b'ic09',
        1024: b'ic10',
    }
    chunks = []
    for size in sorted(png_map.keys()):
        if size not in size_type:
            continue
        data = png_map[size]
        length = 8 + len(data)
        chunks.append(size_type[size] + struct.pack('>I', length) + data)

    if not chunks:
        raise RuntimeError("No valid ICNS chunks generated")

    body = b''.join(chunks)
    file_length = 4 + 4 + len(body)
    header = b'icns' + struct.pack('>I', file_length)
    out_path.write_bytes(header + body)


def write_icns(master: Image.Image):
    print("[5/6] Generando .icns para macOS...")
    png_map = {}
    for size in ICNS_SIZES:
        img = master.resize((size, size), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        png_map[size] = buf.getvalue()

    build_icns(png_map, ASSETS / "icon.icns")
    print("      assets/icon.icns")


# ── Limpieza ───────────────────────────────────────────────────────────────
def cleanup_old_assets():
    print("[6/6] Limpiando assets antiguos...")

    # Borrar PNGs horizontales erróneos en assets/icons/png/
    if ICONS_PNG.exists():
        for f in ICONS_PNG.glob("*.png"):
            f.unlink()
        ICONS_PNG.rmdir()
        print("      Removed assets/icons/png/")

    # Borrar mac/ y win/ si existen (redundantes, usamos assets/icon.icns)
    if ICONS_MAC.exists():
        for f in ICONS_MAC.glob("*"):
            f.unlink()
        ICONS_MAC.rmdir()
        print("      Removed assets/icons/mac/")

    if ICONS_WIN.exists():
        for f in ICONS_WIN.glob("*"):
            f.unlink()
        ICONS_WIN.rmdir()
        print("      Removed assets/icons/win/")

    # Borrar directorio icons/ si queda vacío
    icons_dir = ASSETS / "icons"
    if icons_dir.exists() and not any(icons_dir.iterdir()):
        icons_dir.rmdir()
        print("      Removed empty assets/icons/")

    # Archivos huérfanos en public/
    orphans_public = [
        "favicon-195.png",   # tamaño incorrecto, reemplazado por 180
    ]
    for name in orphans_public:
        p = PUBLIC / name
        if p.exists():
            p.unlink()
            print(f"      Removed public/{name}")

    # Archivos huérfanos en assets/
    orphans_assets = [
        "icon_512.png",
        "app.ico",
        "app.icns",
    ]
    for name in orphans_assets:
        p = ASSETS / name
        if p.exists():
            p.unlink()
            print(f"      Removed assets/{name}")

    # Scripts obsoletos de iconos
    obsolete_scripts = [
        PROJECT / "scripts" / "icon-tools" / "replace_icons.py",
        PROJECT / "scripts" / "icon-tools" / "normalize_icons.py",
        PROJECT / "scripts" / "icon-tools" / "build_app_icon.py",
        PROJECT / "scripts" / "icon-tools" / "update_logos.py",
        PROJECT / "scripts" / "icon-tools" / "update_logos_indiv.py",
        PROJECT / "scripts" / "icon-tools" / "append_css.py",
    ]
    for p in obsolete_scripts:
        if p.exists():
            p.unlink()
            print(f"      Removed {p.name}")

    readme = PROJECT / "scripts" / "icon-tools" / "README.md"
    if readme.exists():
        readme.unlink()
        print("      Removed icon-tools/README.md")

    # Borrar directorio icon-tools si queda vacío
    icon_tools_dir = PROJECT / "scripts" / "icon-tools"
    if icon_tools_dir.exists() and not any(icon_tools_dir.iterdir()):
        icon_tools_dir.rmdir()
        print("      Removed empty scripts/icon-tools/")


# ── Main ───────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("ANTARES Brand Asset Regenerator")
    print("=" * 60)

    # Cargar maestros
    favicon_dark = load_and_trim(ANTARES / "favicon1.png")
    favicon_light = load_and_trim(ANTARES / "favicon2.png")

    # Escalar logos a altura uniforme
    logo_dark = resize_to_height(favicon_dark, LOGO_TARGET_HEIGHT)
    logo_light = resize_to_height(favicon_light, LOGO_TARGET_HEIGHT)

    # Asegurar que public/ y assets/ existan
    PUBLIC.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    # 1. Monograma SVG + raster maestro
    monogram_master = write_monogram_variants()

    # 2. Logos horizontales SVG
    write_logo_svgs(logo_light, logo_dark)

    # 3. Rasteres favicon/icon
    write_monogram_rasters(monogram_master)

    # 4. .ico
    write_ico(monogram_master)

    # 5. .icns
    write_icns(monogram_master)

    # 6. Limpieza
    cleanup_old_assets()

    print("\n[OK] Assets regenerados correctamente.")
    print("     Rebuild del frontend necesario para propagar cambios.")


if __name__ == "__main__":
    main()
