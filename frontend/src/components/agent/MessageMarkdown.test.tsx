import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('html-to-image', () => ({ toBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }));
import MessageMarkdown, { cachedBlocks, parseBlocks, tableClipboard } from './MessageMarkdown';
import { horizontal, niceTicks } from './ChatVisual';
import { FilePreviewContext, localPreviewResource } from './filePreviewContext';

it('abre referencias locales con espacios y rechaza enlaces remotos o ejecutables', () => {
  const open = vi.fn();
  render(<FilePreviewContext.Provider value={open}><MessageMarkdown text={'[Excel](<C:/datos/mi archivo.xlsx>) y `resumen.pdf` [web](https://example.com/doc.pdf)'} /></FilePreviewContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: 'Previsualizar Excel' }));
  expect(open).toHaveBeenLastCalledWith('C:/datos/mi archivo.xlsx');
  fireEvent.click(screen.getByRole('button', { name: 'Previsualizar resumen.pdf' }));
  expect(open).toHaveBeenLastCalledWith('resumen.pdf');
  expect(screen.queryByRole('button', { name: 'Previsualizar web' })).toBeNull();
  expect(localPreviewResource('file:///C:/mis%20datos/acta.docx')).toBe('C:/mis datos/acta.docx');
  for (const value of ['javascript:alert(1).pdf', 'file://servidor/a.pdf', '//servidor/a.pdf', 'mal.exe', '%00.pdf', '%invalid.pdf']) {
    expect(localPreviewResource(value)).toBeNull();
  }
});

it('agrupa párrafos, listas, encabezados y bloques de código', () => {
  const blocks = parseBlocks('# Resumen\nTexto\nsigue\n\n- uno\n- dos\n1. a\n2. b\n```\nconst x = 1;\n```\n> nota');
  expect(blocks.map((b) => b.kind)).toEqual(['h', 'p', 'ul', 'ol', 'code', 'quote']);
  expect(blocks[2]).toEqual({ kind: 'ul', items: ['uno', 'dos'] });
  expect(blocks[4]).toEqual({ kind: 'code', text: 'const x = 1;' });
});

it('muestra negritas, código y listas sin interpretar HTML ni abrir enlaces', () => {
  const { container } = render(<MessageMarkdown text={'**Total**: `42` filas\n\n- <img src=x onerror=alert(1)>\n- [panel](https://evil.example.com)'} />);
  expect(screen.getByText('Total').tagName).toBe('STRONG');
  expect(screen.getByText('42').tagName).toBe('CODE');
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('a')).toBeNull();
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  expect(screen.getByText('panel')).toHaveAttribute('title', 'https://evil.example.com');
});

it('no abre cursiva con guiones bajos dentro de palabras', () => {
  const { container } = render(<MessageMarkdown text={'Usa gmail_search, gmail_get y mi_archivo_final.pdf; esto es _cursiva_ y __negrita__.'} />);
  expect(container.textContent).toContain('Usa gmail_search, gmail_get y mi_archivo_final.pdf; esto es cursiva y negrita.');
  expect([...container.querySelectorAll('em')].map((node) => node.textContent)).toEqual(['cursiva']);
  expect(screen.getByText('negrita').tagName).toBe('STRONG');
});

it('da jerarquía semántica a los títulos sin perder el texto durante el streaming', () => {
  render(<MessageMarkdown text={'## Resumen\nUn párrafo.\n\nOtro párrafo.\n\n### Pendientes'} streaming />);
  expect(screen.getByRole('heading', { name: 'Resumen', level: 3 })).toBeVisible();
  expect(screen.getByRole('heading', { name: /Pendientes/, level: 4 })).toBeVisible();
  expect(screen.getByText('Otro párrafo.')).toBeVisible();
});

it('renderiza tablas con alineación, código y barras escapadas sin interpretar HTML', () => {
  render(<MessageMarkdown text={'| Archivo | Estado | Total |\n| :--- | :---: | ---: |\n| `a|b` | **Listo** | 2 |\n| a\\|b | <img src=x> | 3 |'} />);
  expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Archivo', 'Estado', 'Total']);
  expect(screen.getByRole('columnheader', { name: 'Total' })).toHaveStyle({ textAlign: 'right' });
  expect(screen.getByRole('columnheader', { name: 'Estado' })).toHaveStyle({ textAlign: 'center' });
  expect(screen.getByText('a|b', { selector: 'code' })).toBeVisible();
  expect(screen.getByText('a|b', { selector: 'td' })).toBeVisible();
  expect(screen.getByText('Listo').tagName).toBe('STRONG');
  expect(screen.getByText('<img src=x>')).toBeVisible();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('region', { name: 'Tabla de la respuesta' })).toHaveAttribute('tabindex', '0');
});

it('espera el separador de tabla y conserva celdas incompletas al recibir texto', () => {
  const { rerender } = render(<MessageMarkdown text={'Nombre | Estado\n--- | -'} streaming />);
  expect(screen.queryByRole('table')).toBeNull();
  rerender(<MessageMarkdown text={'Nombre | Estado\n--- | ---\nInforme |'} streaming />);
  expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Informe', '']);
  rerender(<MessageMarkdown text={'Nombre | Estado\n--- | ---\nInforme | Listo\n\nSiguiente paso.'} />);
  expect(screen.getByRole('cell', { name: 'Listo' })).toBeVisible();
  expect(screen.getByText('Siguiente paso.')).toBeVisible();
});

it('conserva las barras de texto ordinario y las tablas dentro de código', () => {
  render(<MessageMarkdown text={'a | b\ntexto | normal\n\n```txt\na | b\n--- | ---\n```'} />);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByText(/texto \| normal/)).toBeVisible();
});

const chart = '```chart\n{"type":"bar","title":"Ventas","labels":["Ene","Feb"],"series":[{"name":"2026","data":[3,5]}]}\n```';

it('reconoce el lenguaje del bloque y marca los que siguen abiertos', () => {
  expect(parseBlocks(chart)[0]).toMatchObject({ kind: 'code', lang: 'chart' });
  expect(parseBlocks(chart)[0]).not.toHaveProperty('open');
  expect(parseBlocks('```svg\n<svg>')[0]).toMatchObject({ lang: 'svg', open: true });
});

it('dibuja un bloque chart como gráfico SVG y permite ver su código', async () => {
  const { container } = render(<MessageMarkdown text={chart} />);
  expect(await screen.findByRole('img', { name: 'Ventas' })).toBeInTheDocument();
  expect(container.querySelectorAll('[data-bar]')).toHaveLength(2);
  expect(container.querySelector('pre')).toBeNull();
  fireEvent.mouseEnter(container.querySelectorAll('rect[fill="transparent"]')[1]);
  expect(screen.getByRole('tooltip')).toHaveTextContent('Feb20265');
  expect(screen.getByRole('table')).toHaveTextContent('Ene3');
  fireEvent.click(screen.getByRole('button', { name: 'Código' }));
  expect(container.querySelector('pre')?.textContent).toContain('"Ventas"');
});

it('dibuja un chart pie como dona con total y porcentajes', async () => {
  const { container } = render(<MessageMarkdown text={'```chart\n{"type":"pie","labels":["A","B"],"series":[{"data":[3,1]}]}\n```'} />);
  expect(await screen.findByRole('img', { name: 'Gráfico' })).toBeInTheDocument();
  expect(container.querySelectorAll('[data-slice]')).toHaveLength(2);
  expect(screen.getByText('Total')).toBeInTheDocument();
  expect(screen.getByText('75 %')).toBeInTheDocument();
});

it('redondea los ejes a pasos legibles', () => {
  expect(niceTicks(0, 48)).toEqual([0, 20, 40, 60]);
  expect(niceTicks(-3, 9)).toEqual([-5, 0, 5, 10]);
});

it('muestra un marcador mientras el bloque se transmite y el código si queda abierto o el JSON es inválido', async () => {
  const { container, rerender } = render(<MessageMarkdown text={chart.slice(0, -3)} streaming />);
  expect(screen.getByRole('status')).toHaveTextContent('Generando gráfico…');
  expect(container.querySelector('pre')).toBeNull();
  rerender(<MessageMarkdown text={chart.slice(0, -3)} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(container.querySelector('pre')?.textContent).toContain('"Ventas"');
  rerender(<MessageMarkdown text={'```chart\n{"type":"bar","labels":["a"],"series":[]}\n```'} />);
  await waitFor(() => expect(container.querySelector('pre')?.textContent).toContain('"series":[]'));
  expect(screen.queryByRole('img')).toBeNull();
});

it('aísla HTML y SVG en un iframe sin scripts y sanitizado', async () => {
  render(<MessageMarkdown text={'```html\n<div onclick="x()">Hola</div><script>alert(1)</script>\n```'} />);
  const frame = await screen.findByTitle('Interfaz');
  expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
  const doc = frame.getAttribute('srcdoc') ?? '';
  expect(doc).toContain('Hola');
  expect(doc).toContain("script-src 'none'");
  expect(doc).not.toMatch(/<script|onclick/);
});

it('enmarca el código con su lenguaje y lo copia al terminar de escribirse', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const { rerender } = render(<MessageMarkdown text={'```ts\nconst x = 1;'} streaming />);
  expect(screen.getByText('ts')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copiar código' })).not.toBeInTheDocument();
  rerender(<MessageMarkdown text={'```\nconst x = 1;\n```'} />);
  expect(screen.getByText('código')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copiar código' }));
  expect(writeText).toHaveBeenCalledWith('const x = 1;');
});

it('reutiliza los bloques de un mensaje terminado y no cachea el que sigue llegando', () => {
  const text = '# Informe\n\nTexto final';
  expect(cachedBlocks(text, false)).toBe(cachedBlocks(text, false));
  expect(cachedBlocks(text, true)).not.toBe(cachedBlocks(text, true));
  expect(cachedBlocks(text, true)).toEqual(cachedBlocks(text, false));
});

it('dibuja separadores, tachado, tareas, numeración inicial y citas de varias líneas', () => {
  const blocks = parseBlocks('Antes\n\n---\n\n3. tres\n4. cuatro\n\n> uno\n> dos\n\n> otra');
  expect(blocks.map((b) => b.kind)).toEqual(['p', 'hr', 'ol', 'quote', 'quote']);
  expect(blocks[2]).toEqual({ kind: 'ol', items: ['tres', 'cuatro'], start: 3 });
  expect(blocks[3]).toEqual({ kind: 'quote', text: 'uno\ndos' });
  const { container } = render(<MessageMarkdown text={'~~viejo~~ nuevo\n\n* * *\n\n- [x] Hecho\n- [ ] Pendiente\n- normal\n\n2. b'} />);
  expect(screen.getByText('viejo').tagName).toBe('DEL');
  expect(container.querySelectorAll('hr')).toHaveLength(1);
  const boxes = screen.getAllByRole('checkbox');
  expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
  expect(screen.getByText('normal').tagName).toBe('LI');
  expect(container.querySelector('ol')).toHaveAttribute('start', '2');
});

it('pasa a barras horizontales cuando las etiquetas son largas', async () => {
  const source = '{"type":"bar","title":"Metrado por actividad","labels":["Excavación de zanjas","Relleno compactado"],"series":[{"name":"m3","data":[120,80]}]}';
  const { container } = render(<MessageMarkdown text={'```chart\n' + source + '\n```'} />);
  expect(await screen.findByRole('img', { name: 'Metrado por actividad' })).toBeInTheDocument();
  expect(container.querySelector('svg[role="img"]')).toBeNull();
  expect(screen.getByTitle('Excavación de zanjas')).toBeInTheDocument();
  const bars = container.querySelectorAll<HTMLElement>('[data-bar]');
  expect([...bars].map((bar) => bar.style.width)).toEqual(['100%', `${(80 / 120) * 100}%`]);
  expect(horizontal({ type: 'bar', title: '', labels: ['Excavación de zanjas'], series: [{ name: 'a', data: [-1] }] })).toBe(false);
  expect(horizontal({ type: 'bar', title: '', labels: ['Ene'], series: [{ name: 'a', data: [1] }] })).toBe(false);
});

class FakeClipboardItem {
  constructor(public items: Record<string, Blob>) {}
}

function stubClipboard() {
  const write = vi.fn(async (_items: FakeClipboardItem[]) => undefined);
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { write, writeText: vi.fn(async () => undefined) } });
  return write;
}

it('prepara una tabla para Excel como HTML y texto sin marcas de markdown', () => {
  const { text, html } = tableClipboard(['Partida', 'Metrado'], [['**Excavación** <zanja>', '1250'], ['[Relleno](C:/a.xlsx)', '`830`']]);
  expect(text).toBe('Partida\tMetrado\nExcavación <zanja>\t1250\nRelleno\t830');
  expect(html).toBe('<table><thead><tr><th>Partida</th><th>Metrado</th></tr></thead><tbody>'
    + '<tr><td>Excavación &lt;zanja&gt;</td><td>1250</td></tr><tr><td>Relleno</td><td>830</td></tr></tbody></table>');
});

it('copia una tabla terminada con su estructura y no ofrece copiarla mientras llega', async () => {
  const write = stubClipboard();
  try {
    const table = '| Partida | Metrado |\n| --- | ---: |\n| Excavación | 1250 |';
    const { rerender } = render(<MessageMarkdown text={table} streaming />);
    expect(screen.queryByRole('button', { name: 'Copiar tabla' })).toBeNull();
    rerender(<MessageMarkdown text={table} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar tabla' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const item = write.mock.calls[0][0][0];
    expect(Object.keys(item.items)).toEqual(['text/html', 'text/plain']);
    expect(await item.items['text/plain'].text()).toBe('Partida\tMetrado\nExcavación\t1250');
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('copia un gráfico como imagen PNG y oculta la opción en la vista de código', async () => {
  const write = stubClipboard();
  try {
    const { toBlob } = await import('html-to-image');
    render(<MessageMarkdown text={chart} />);
    await screen.findByRole('img', { name: 'Ventas' });
    fireEvent.click(screen.getByRole('button', { name: 'Copiar imagen' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(toBlob).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ pixelRatio: 2 }));
    expect(Object.keys(write.mock.calls[0][0][0].items)).toEqual(['image/png']);
    expect(await screen.findByRole('button', { name: 'Imagen copiada' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Código' }));
    expect(screen.queryByRole('button', { name: /imagen/i })).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
