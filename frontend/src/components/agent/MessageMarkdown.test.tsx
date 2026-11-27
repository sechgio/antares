import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('html-to-image', () => ({ toBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }));
import MessageMarkdown, { cachedBlocks, parseBlocks, splitMarkdownBlocks, tableClipboard } from './MessageMarkdown';
import { chartToMermaid, horizontalChart, niceTicks, parseChartSpec, pieSlices } from '../../../../shared/chart-spec.js';
import { mermaidTitle } from './ChatMermaid';
import { FilePreviewContext, localPreviewResource } from './filePreviewContext';

it('distingue el visor de archivos local de una fuente web', () => {
  const open = vi.fn();
  render(<FilePreviewContext.Provider value={open}><MessageMarkdown text={'[Excel](<C:/datos/mi archivo.xlsx>) y `resumen.pdf` [web](https://example.com/doc.pdf)'} /></FilePreviewContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: 'Previsualizar Excel' }));
  expect(open).toHaveBeenLastCalledWith('C:/datos/mi archivo.xlsx');
  fireEvent.click(screen.getByRole('button', { name: 'Previsualizar resumen.pdf' }));
  expect(open).toHaveBeenLastCalledWith('resumen.pdf');
  expect(screen.queryByRole('button', { name: 'Previsualizar web' })).toBeNull();
  expect(screen.getByRole('link', { name: 'web' })).toHaveAttribute('href', 'https://example.com/doc.pdf');
  expect(localPreviewResource('file:///C:/mis%20datos/acta.docx')).toBe('C:/mis datos/acta.docx');
  for (const value of ['javascript:alert(1).pdf', 'file://servidor/a.pdf', '//servidor/a.pdf', 'mal.exe', '%00.pdf', '%invalid.pdf']) {
    expect(localPreviewResource(value)).toBeNull();
  }
});

it('agrupa párrafos, listas, encabezados y bloques de código', () => {
  const blocks = parseBlocks('# Resumen\nTexto\nsigue\n\n- uno\n- dos\n1. a\n2. b\n```\nconst x = 1;\n```\n> nota');
  expect(blocks.map((b) => b.kind)).toEqual(['h', 'p', 'ul', 'ol', 'code', 'quote']);
  expect(blocks[2]).toEqual({ kind: 'ul', items: [{ text: 'uno', depth: 0, kind: 'ul' }, { text: 'dos', depth: 0, kind: 'ul' }] });
  expect(blocks[4]).toEqual({ kind: 'code', text: 'const x = 1;' });
});

it('muestra HTML como texto y limita la navegación a fuentes HTTPS', () => {
  const { container } = render(<MessageMarkdown text={'**Total**: `42` filas\n\n- <img src=x onerror=alert(1)>\n- [panel](https://evil.example.com)'} />);
  expect(screen.getByText('Total').tagName).toBe('STRONG');
  expect(screen.getByText('42').tagName).toBe('CODE');
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByRole('link', { name: 'panel' })).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('link', { name: 'panel' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  expect(screen.getByText('panel')).toHaveAttribute('title', 'https://evil.example.com');
});

it('resuelve referencias cuando su destino completo llega y conserva otros protocolos como texto', () => {
  const text = '[Publicación][fuente], [insegura](http://example.com), [privada](https://a:b@example.com) y [archivo](javascript:prompt%281%29)';
  const { rerender } = render(<MessageMarkdown text={text} streaming />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  rerender(<MessageMarkdown text={text + '\n\n[fuente]: <https://example.com/mi fuente>'} />);
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Publicación' })).toHaveAttribute('href', 'https://example.com/mi%20fuente');
});

it('reconoce cercas largas, tildes y énfasis anidado en ambos estados del stream', () => {
  const input = '**Un *detalle***\n\n~~~~text\n~~~\nliteral\n';
  const { container, rerender } = render(<MessageMarkdown text={input} streaming />);
  expect(container.querySelector('strong em')).toHaveTextContent('detalle');
  expect(parseBlocks(input)[1]).toMatchObject({ open: true, text: '~~~\nliteral\n' });
  rerender(<MessageMarkdown text={input + '~~~~\n\nListo'} />);
  expect(screen.getByText('Listo')).toBeVisible();
  expect(parseBlocks(input + '~~~~')[1]).not.toHaveProperty('open');
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

it('amplía una tabla Markdown y permite filtrar, ordenar y copiar sus filas', () => {
  const lines = ['Nombre | Estado', '--- | ---', ...Array.from({ length: 12 }, (_, i) => `Fila ${i + 1} | Listo`)];
  render(<MessageMarkdown text={lines.join('\n')} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ampliar tabla' }));
  const viewer = within(screen.getByRole('dialog', { name: 'Tabla de la respuesta' }));
  fireEvent.change(viewer.getByRole('textbox', { name: 'Filtrar filas' }), { target: { value: 'Fila 12' } });
  expect(viewer.getByRole('cell', { name: 'Fila 12' })).toBeVisible();
  expect(viewer.queryByRole('cell', { name: 'Fila 1' })).not.toBeInTheDocument();
  expect(viewer.getByRole('button', { name: 'Copiar filas para Excel' })).toBeEnabled();
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

it('dibuja un bloque chart como gráfico SVG con Pele y permite ver su código', async () => {
  const { container } = render(<MessageMarkdown text={chart} />);
  expect(await screen.findByRole('region', { name: 'Ventas' })).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('.pele-xychart')).not.toBeNull());
  expect(container.querySelectorAll('.pele-series.pele-bars rect')).toHaveLength(2);
  expect(container.querySelector('pre')).toBeNull();
  fireEvent.mouseEnter(container.querySelectorAll('.pele-series.pele-bars rect')[1]);
  expect(screen.getByRole('tooltip')).toHaveTextContent('Feb');
  expect(screen.getByRole('tooltip')).toHaveTextContent('2026');
  expect(screen.getByRole('table', { hidden: true })).toHaveTextContent('Ene3');
  fireEvent.click(screen.getByRole('button', { name: 'Código' }));
  expect(container.querySelector('pre')?.textContent).toContain('"Ventas"');
});

it('dibuja un chart pie con Pele y muestra valor y porcentaje al pasar por una porción', async () => {
  const { container } = render(<MessageMarkdown text={'```chart\n{"type":"pie","labels":["A","B"],"series":[{"data":[3,1]}]}\n```'} />);
  expect(await screen.findByRole('region', { name: 'Gráfico' })).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('.pele-pie')).not.toBeNull());
  expect(container.querySelectorAll('.pele-slice')).toHaveLength(2);
  fireEvent.mouseEnter(container.querySelector('.pele-slice[data-id="A"]')!);
  const tooltip = screen.getByRole('tooltip');
  expect(tooltip).toHaveTextContent('A');
  expect(tooltip).toHaveTextContent('75 %');
});

it('amplía un gráfico en un diálogo y lo cierra', async () => {
  const { container } = render(<MessageMarkdown text={chart} />);
  await screen.findByRole('region', { name: 'Ventas' });
  await waitFor(() => expect(container.querySelector('.pele-xychart')).not.toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Ampliar' }));
  const dialog = screen.getByRole('dialog', { name: 'Ventas' });
  await waitFor(() => expect(dialog.querySelector('.pele-xychart')).not.toBeNull());
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar vista ampliada' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Código' }));
  expect(screen.queryByRole('button', { name: 'Ampliar' })).toBeNull();
});

it('dibuja un bloque mermaid como diagrama SVG sanitizado y explica los errores', async () => {
  const diagram = '```mermaid\nflowchart LR\n  A[Inicio] --> B[Fin]\n  click A "javascript:alert(1)"\n```';
  const { container, rerender } = render(<MessageMarkdown text={diagram} />);
  expect(await screen.findByRole('region', { name: 'Diagrama de flujo' })).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('[data-mermaid] svg')).not.toBeNull());
  const svg = container.querySelector('[data-mermaid]')!.innerHTML;
  expect(svg).toContain('Inicio');
  expect(svg).not.toMatch(/<a\b|javascript:|<script|<style/);
  rerender(<MessageMarkdown text={'```mermaid\nesto no es un diagrama\n```'} />);
  expect(await screen.findByText(/No se pudo dibujar el diagrama/)).toBeInTheDocument();
  expect(container.querySelector('pre')?.textContent).toBe('esto no es un diagrama');
});

it('titula un diagrama mermaid con su title o con su tipo', () => {
  expect(mermaidTitle('pie title Uso del agua\n  "Riego" : 70')).toBe('Uso del agua');
  expect(mermaidTitle('---\ntitle: "Flujo de aprobación"\n---\nflowchart LR\n  A --> B')).toBe('Flujo de aprobación');
  expect(mermaidTitle('%% nota\nsequenceDiagram\n  A->>B: hola')).toBe('Diagrama de secuencia');
  expect(mermaidTitle('quadrantChart\n  x-axis a --> b')).toBe('Diagrama');
});

it('convierte todas las marcas de una serie larga sin recortar los datos', async () => {
  const labels = Array.from({ length: 40 }, (_, i) => `D${i + 1}`);
  const source = JSON.stringify({ type: 'line', title: 'Caudal', labels, series: [{ name: 'Q', data: labels.map((_, i) => i) }] });
  const { container } = render(<MessageMarkdown text={'```chart\n' + source + '\n```'} />);
  await screen.findByRole('region', { name: 'Caudal' });
  await waitFor(() => expect(container.querySelector('.pele-xychart')).not.toBeNull());
  expect(container.querySelectorAll('.pele-series.pele-line circle')).toHaveLength(40);
});

it('ajusta el eje de una línea al rango de sus datos y el de barras al cero', () => {
  const line = parseChartSpec('{"type":"line","title":"pH","labels":["a","b","c"],"series":[{"name":"pH","data":[7.12,6.98,7.21]}]}')!;
  expect(chartToMermaid(line)).toContain('y-axis 6.9 --> 7.3');
  const bars = parseChartSpec('{"type":"bar","title":"pH","labels":["a","b","c"],"series":[{"name":"pH","data":[7.12,6.98,7.21]}]}')!;
  expect(chartToMermaid(bars)).toContain('y-axis 0 --> 8');
  const negative = parseChartSpec('{"type":"line","title":"n","labels":["a","b"],"series":[{"name":"n","data":[-3,8]}]}')!;
  expect(chartToMermaid(negative)).toContain('y-axis -5 --> 10');
});

it('agrupa en "Otros" las porciones que repetirían color', () => {
  const labels = Array.from({ length: 10 }, (_, i) => `C${i + 1}`);
  const spec = { type: 'pie' as const, title: '', labels, series: [{ name: 'n', data: [30, 2, 20, 12, 9, 8, 7, 5, 4, 3] }] };
  expect(pieSlices(spec)).toEqual({
    labels: ['C1', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'Otros'],
    data: [30, 20, 12, 9, 8, 7, 5, 9],
  });
  expect(pieSlices({ ...spec, labels: labels.slice(0, 3), series: [{ name: 'n', data: [1, 2, 3] }] }).labels).toEqual(['C1', 'C2', 'C3']);
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
  expect(screen.getByText('No se pudo dibujar el gráfico; se muestra su código.')).toBeInTheDocument();
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

it('permite ajustar las líneas largas de un bloque de código', () => {
  const { container } = render(<MessageMarkdown text={'```ts\nconst linea = "muy larga";\n```'} />);
  const pre = container.querySelector('pre')!;
  expect(pre).toHaveClass('overflow-x-auto', 'whitespace-pre');
  const toggle = screen.getByRole('button', { name: 'Ajustar líneas' });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'No ajustar líneas' })).toBeInTheDocument();
  expect(pre).toHaveClass('whitespace-pre-wrap', 'break-words');
  expect(pre).not.toHaveClass('overflow-x-auto');
});

it('divide el streaming solo en cortes seguros entre bloques', () => {
  expect(splitMarkdownBlocks('# Título\n\nPrimer párrafo\n\nSegundo')).toEqual(['# Título\n\n', 'Primer párrafo\n\n', 'Segundo']);
  expect(splitMarkdownBlocks('```ts\nuno\n\ndos\n```\n\nDespués')).toEqual(['```ts\nuno\n\ndos\n```\n\n', 'Después']);
  expect(splitMarkdownBlocks('- uno\n\n  continuación')).toBeNull();
});

it('conserva el estado de los bloques cuando termina el streaming', () => {
  const text = 'Introducción\n\n```ts\nconst x = 1;\n```';
  const { container, rerender } = render(<MessageMarkdown text={text} streaming />);
  expect(container.textContent).toContain('▍');
  fireEvent.click(screen.getByRole('button', { name: 'Ajustar líneas' }));
  rerender(<MessageMarkdown text={text} />);
  expect(screen.getByRole('button', { name: 'No ajustar líneas' })).toHaveAttribute('aria-pressed', 'true');
  expect(container.textContent).not.toContain('▍');
});

it('renderiza listas anidadas conservando su jerarquía', () => {
  const { container } = render(<MessageMarkdown text={'- Padre\n  - Hijo\n    - Nieto\n- Hermano'} />);
  const root = container.querySelector('ul')!;
  const top = [...root.children] as HTMLElement[];
  expect(top).toHaveLength(2);
  expect(top[0]).toHaveTextContent('Padre');
  expect(top[1]).toHaveTextContent('Hermano');
  const childList = top[0].querySelector(':scope > ul');
  expect(childList).not.toBeNull();
  expect(childList).toHaveTextContent('Hijo');
  expect(childList!.querySelector(':scope > li > ul > li')).toHaveTextContent('Nieto');
  expect(top[1].querySelector(':scope > ul')).toBeNull();
});

it('mezcla listas numeradas dentro de viñetas sin perder la jerarquía', () => {
  const { container } = render(<MessageMarkdown text={'- Padre\n  1. Primero\n  2. Segundo\n- Hermano'} />);
  const root = container.querySelector('ul')!;
  const top = [...root.children] as HTMLElement[];
  expect(top).toHaveLength(2);
  const childList = top[0].querySelector(':scope > ol');
  expect(childList).not.toBeNull();
  expect([...childList!.children].map((item) => item.textContent)).toEqual(['Primero', 'Segundo']);
  expect(top[1]).toHaveTextContent('Hermano');
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
  expect(blocks[2]).toEqual({
    kind: 'ol',
    items: [
      { text: 'tres', depth: 0, kind: 'ol', start: 3 },
      { text: 'cuatro', depth: 0, kind: 'ol', start: 4 },
    ],
  });
  expect(blocks[3]).toEqual({ kind: 'quote', text: 'uno\ndos' });
  const { container } = render(<MessageMarkdown text={'~~viejo~~ nuevo\n\n* * *\n\n- [x] Hecho\n- [ ] Pendiente\n- normal\n\n2. b'} />);
  expect(screen.getByText('viejo').tagName).toBe('DEL');
  expect(container.querySelectorAll('hr')).toHaveLength(1);
  const boxes = screen.getAllByRole('checkbox');
  expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
  expect(screen.getByText('normal').tagName).toBe('LI');
  expect(container.querySelector('ol')).toHaveAttribute('start', '2');
});

it('convierte a barras horizontales cuando las etiquetas son largas', async () => {
  const source = '{"type":"bar","title":"Metrado por actividad","labels":["Excavación de zanjas","Relleno compactado"],"series":[{"name":"m3","data":[120,80]}]}';
  const spec = parseChartSpec(source)!;
  expect(horizontalChart(spec)).toBe(true);
  expect(chartToMermaid(spec)).toContain('xychart-beta horizontal');
  expect(horizontalChart({ type: 'bar', title: '', labels: ['Excavación de zanjas'], series: [{ name: 'a', data: [-1] }] })).toBe(false);
  expect(horizontalChart({ type: 'bar', title: '', labels: ['Ene'], series: [{ name: 'a', data: [1] }] })).toBe(false);
  const { container } = render(<MessageMarkdown text={'```chart\n' + source + '\n```'} />);
  expect(await screen.findByRole('region', { name: 'Metrado por actividad' })).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('.pele-xychart')).not.toBeNull());
  expect(container.querySelectorAll('.pele-series.pele-bars rect')).toHaveLength(2);
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
    const { container } = render(<MessageMarkdown text={chart} />);
    await screen.findByRole('region', { name: 'Ventas' });
    await waitFor(() => expect(container.querySelector('.pele-xychart')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Copiar imagen' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(toBlob).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ pixelRatio: 2 }));
    const options = vi.mocked(toBlob).mock.calls[0][1] as { filter?: (element: Node) => boolean };
    const zoom = document.createElement('div');
    zoom.classList.add('pele-zoom');
    expect(options.filter?.(zoom)).toBe(false);
    expect(options.filter?.(document.createElement('svg'))).toBe(true);
    expect(Object.keys(write.mock.calls[0][0][0].items)).toEqual(['image/png']);
    expect(await screen.findByRole('button', { name: 'Imagen copiada' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Código' }));
    expect(screen.queryByRole('button', { name: /imagen/i })).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
