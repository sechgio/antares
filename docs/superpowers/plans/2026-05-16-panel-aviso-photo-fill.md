# Panel Aviso Photo Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que las imagenes del PDF de panel aviso ocupen todo su recuadro sin romper la grilla de 4 imagenes por hoja.

**Architecture:** El cambio queda contenido en la plantilla HTML del PDF. Primero se agrega una prueba de contrato que fija la geometria visual esperada de las imagenes y luego se ajusta el CSS de `.cell-photo-inner` y `.cell-photo img` para llenar la celda con `object-fit: cover`, conservando las alturas actuales del panel.

**Tech Stack:** Python, pytest, Jinja2, HTML/CSS, WeasyPrint.

---

### Task 1: Contrato visual de las fotos

**Files:**
- Modify: `tests/panel_aviso_corte/test_rendering.py`

- [ ] **Step 1: Write the failing test**

```python
def test_pdf_template_photos_fill_their_cells() -> None:
    template_path = _ROOT / "backend" / "templates" / "panel-aviso-corte.html"
    template = template_path.read_text(encoding="utf-8")

    assert ".cell-photo-inner {\n      width: 100%;\n      height: 100%;" in template
    assert ".cell-photo img {\n      width: 100%;\n      height: 100%;" in template
    assert "object-fit: cover;" in template
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/panel_aviso_corte/test_rendering.py::test_pdf_template_photos_fill_their_cells -q`

Expected: FAIL because the current template still uses fixed photo limits and `object-fit: contain`.

- [ ] **Step 3: Commit the test**

```bash
git add tests/panel_aviso_corte/test_rendering.py
git commit -m "test: pin panel aviso photo fill contract"
```

### Task 2: Llenado completo de las celdas

**Files:**
- Modify: `backend/templates/panel-aviso-corte.html`
- Test: `tests/panel_aviso_corte/test_rendering.py`

- [ ] **Step 1: Write minimal implementation**

```css
.cell-photo-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow: hidden;
}
.cell-photo img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
```

- [ ] **Step 2: Run the focused tests**

Run: `pytest tests/panel_aviso_corte/test_rendering.py::test_pdf_template_photos_fill_their_cells tests/panel_aviso_corte/test_rendering.py::test_render_pdf_fixture_keeps_four_images_per_page -q`

Expected: PASS.

- [ ] **Step 3: Commit the implementation**

```bash
git add backend/templates/panel-aviso-corte.html tests/panel_aviso_corte/test_rendering.py
git commit -m "fix: fill panel aviso photo cells"
```

### Task 3: Verificacion enfocada

**Files:**
- No new files.

- [ ] **Step 1: Run the full focused suite**

Run: `pytest tests/panel_aviso_corte/test_rendering.py -q`

Expected: PASS.

- [ ] **Step 2: Inspect the diff**

Run: `git diff -- backend/templates/panel-aviso-corte.html tests/panel_aviso_corte/test_rendering.py`

Expected: Only the photo fill CSS change and its regression test are present.
