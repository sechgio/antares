import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import MessageMarkdown, { parseBlocks } from './MessageMarkdown';
import { niceTicks } from './ChatVisual';

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
