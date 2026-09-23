import { describe, expect, it } from "vitest";
import { renderPreviewHtml } from "./PreviewPanel";

const img = (name: string) =>
  new File(["x"], name, { type: "image/png", lastModified: 1700000000000 });

describe("renderPreviewHtml — plantilla por defecto", () => {
  it('renderiza valores mapeados y "-" cuando falta data', () => {
    const html = renderPreviewHtml({
      data: { col_dir: "Av. X 123", col_nis: "7788" },
      mappings: { direccion: "col_dir", nis: "col_nis" },
    });
    expect(html).toContain("Av. X 123");
    expect(html).toContain("7788");
  });

  it("sin data muestra guiones en los campos", () => {
    const html = renderPreviewHtml({ data: null });
    expect(html).toContain("-");
    expect(html).not.toContain("undefined");
  });

  it("incluye logos cuando se pasan", () => {
    const html = renderPreviewHtml({
      data: { x: "1" },
      mappings: {},
      logoLeft: "data:image/png;base64,AAA",
      logoRight: "data:image/png;base64,BBB",
    });
    expect(html).toContain("AAA");
    expect(html).toContain("BBB");
  });

  it("layout de fotos: 3 usa top/bottom-row, N genérico, 0 muestra no-photos", () => {
    const base = { data: {}, mappings: {} };
    const three = renderPreviewHtml({
      ...base,
      images: [img("1"), img("2"), img("3")],
      imageUrls: ["a", "b", "c"],
    });
    expect(three).toContain("layout-3");
    expect(three).toContain("top-row");
    const five = renderPreviewHtml({
      ...base,
      images: [img("1"), img("2"), img("3"), img("4"), img("5")],
    });
    expect(five).toContain("layout-5");
    const none = renderPreviewHtml({ ...base });
    expect(none).toContain("no-photos");
  });
});

describe("renderPreviewHtml — template custom jinja", () => {
  const tpl = (content: string) => ({ name: "custom.html", content });

  it("sustituye title y logos (EMPTY_PIXEL sin logo)", () => {
    const html = renderPreviewHtml({
      customTemplate: tpl('<h1>{{ title }}</h1><img src="{{ logo_left }}">'),
    });
    expect(html).toContain("PANEL FOTOGRÁFICO VOLANTEO");
    expect(html).toContain("data:image/svg+xml");
  });

  it("if logo_left con y sin logo", () => {
    const t = tpl("{% if logo_left %}SI{% else %}NO{% endif %}");
    expect(renderPreviewHtml({ customTemplate: t, logoLeft: "L" })).toContain(
      "SI",
    );
    expect(renderPreviewHtml({ customTemplate: t })).toContain("NO");
    const tNoElse = tpl("{% if logo_right %}R{% endif %}");
    expect(renderPreviewHtml({ customTemplate: tNoElse })).not.toContain("R{%");
  });

  it("un '{%' literal en el texto no borra el contenido hasta la siguiente etiqueta", () => {
    const t = tpl(
      "<p>Descuento 20{% menor</p>{% if customColumns|length > 0 %}<span>IMPORTANTE</span>{% endif %}<p>FIN</p>",
    );
    const html = renderPreviewHtml({
      customTemplate: t,
      customColumns: [{ id: "c1", name: "Columna" }],
    });
    expect(html).toContain("20{% menor");
    expect(html).toContain("IMPORTANTE");
    expect(html).toContain("FIN");
    expect(html).not.toContain("{% endif %}");
  });

  it("if report.images|length == N / != / > / >= / < / elif", () => {
    const images = [img("a.png"), img("b.png")];
    const t = tpl(
      "{% if report.images|length == 2 %}DOS{% else %}OTRO{% endif %}",
    );
    expect(renderPreviewHtml({ customTemplate: t, images })).toContain("DOS");
    expect(renderPreviewHtml({ customTemplate: t, images: [] })).toContain(
      "OTRO",
    );

    const tGt = tpl(
      "{% if report.images|length > 1 %}GT{% else %}LE{% endif %}",
    );
    expect(renderPreviewHtml({ customTemplate: tGt, images })).toContain("GT");

    const tNeq = tpl(
      "{% if report.images|length != 1 and report.images|length != 3 %}NE{% endif %}",
    );
    expect(renderPreviewHtml({ customTemplate: tNeq, images })).toContain("NE");

    const tElif = tpl(
      "{% if report.images|length == 0 %}CERO{% elif report.images|length == 2 %}DOS{% else %}OTRO{% endif %}",
    );
    expect(renderPreviewHtml({ customTemplate: tElif, images })).toContain(
      "DOS",
    );
    expect(
      renderPreviewHtml({ customTemplate: tElif, images: [img("x.png")] }),
    ).toContain("OTRO");

    const tGe = tpl(
      "{% if report.images|length >= 2 %}GE{% else %}LT{% endif %}",
    );
    expect(renderPreviewHtml({ customTemplate: tGe, images })).toContain("GE");

    const tLt = tpl("{% if report.images|length < 5 %}LT{% endif %}");
    expect(renderPreviewHtml({ customTemplate: tLt, images })).toContain("LT");
  });

  it("for img in report.images genera una iteración por imagen", () => {
    const t = tpl(
      '{% for img in report.images %}<img src="{{ img.path }}" alt="{{ img.name }}">{% endfor %}',
    );
    const html = renderPreviewHtml({
      customTemplate: t,
      images: [img("uno.png"), img("dos.png")],
      imageUrls: ["blob:u1", "blob:u2"],
    });
    expect(html).toContain("blob:u1");
    expect(html).toContain("blob:u2");
    expect(html).toContain("uno.png");
  });

  it("for con límite [:1] renderiza solo la primera", () => {
    const t = tpl(
      "{% for img in report.images[:1] %}{{ img.name }}{% endfor %}",
    );
    const html = renderPreviewHtml({
      customTemplate: t,
      images: [img("uno.png"), img("dos.png")],
      imageUrls: ["u1", "u2"],
    });
    expect(html).toContain("uno.png");
    expect(html).not.toContain("dos.png");
  });

  it("loop.first e loop.index funcionan", () => {
    const t = tpl(
      "{% for img in report.images %}{% if loop.first %}PRIMERO{% endif %}{{ loop.index }}.{{ img.name }}{% endfor %}",
    );
    const html = renderPreviewHtml({
      customTemplate: t,
      images: [img("a.png"), img("b.png")],
      imageUrls: ["", ""],
    });
    expect(html).toContain("PRIMERO1.a.png2.b.png");
  });

  it("report.data.get con valor, con default y con default anidado", () => {
    const t = tpl(
      "{{ report.data.get('NOMBRE', 'sin') }}|{{ report.data.get('FALTA', 'def') }}",
    );
    const html = renderPreviewHtml({
      customTemplate: t,
      data: { col: "VAL" },
      mappings: { nombre: "col" },
    });
    expect(html).toContain("VAL|def");
  });

  it("img_count patterns: if img_count == N", () => {
    const t = tpl("{% if img_count == 3 %}TRES{% else %}NO{% endif %}");
    const html = renderPreviewHtml({
      customTemplate: t,
      images: [img("a"), img("b"), img("c")],
    });
    expect(html).toContain("TRES");
  });

  it('elimina placeholders "Sin imagen" cuando hay imágenes', () => {
    const t = tpl('<div class="photo-placeholder"> Sin imagen </div>');
    const withImg = renderPreviewHtml({
      customTemplate: t,
      images: [img("a.png")],
    });
    expect(withImg).not.toContain("Sin imagen");
    const without = renderPreviewHtml({ customTemplate: t });
    expect(without).toContain("Sin imagen");
  });

  it("panel_count se reemplaza con min(images,4)", () => {
    const t = tpl("<span>{{ panel_count }}</span>");
    const html = renderPreviewHtml({
      customTemplate: t,
      images: [img("a"), img("b")],
    });
    expect(html).toContain("<span>2</span>");
  });
});

describe("renderPreviewHtml — plantillas conocidas", () => {
  it("maquina-balde detectada por nombre genera A4 fijo", () => {
    const html = renderPreviewHtml({
      customTemplate: { name: "maquina-balde.html", content: "<x></x>" },
      data: { NIS: "999" },
      images: [img("a.png")],
    });
    expect(html).toContain("Maquina");
    expect(html).toContain("210mm");
  });

  it("maq balde detectada por contenido del template", () => {
    const html = renderPreviewHtml({
      customTemplate: { name: "otro.html", content: "row.get('titulo'" },
      data: { DISTRITO: "SJL" },
    });
    expect(html).toContain("Localizacion");
  });

  it("photo-grid recibe css compat si falta", () => {
    const t = {
      name: "x.html",
      content:
        '<html><head></head><body><div class="photo-cell-wrap"></div></body></html>',
    };
    const html = renderPreviewHtml({ customTemplate: t });
    expect(html).toContain("photo-grid-compat-fix");
    // idempotente si ya viene
    const fixed = {
      name: "x.html",
      content:
        '<div class="photo-cell-wrap"></div><style id="photo-grid-compat-fix"></style>',
    };
    const html2 = renderPreviewHtml({ customTemplate: fixed });
    expect(html2.match(/photo-grid-compat-fix/g)?.length).toBe(1);
  });
});
