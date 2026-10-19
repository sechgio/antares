import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import MessageMarkdown, { parseBlocks } from './MessageMarkdown';

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
