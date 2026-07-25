import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import LayerNode from '../editor/LayerNode';

const baseHandlers = {
  onSelect: vi.fn(),
  onLayerPointerDown: vi.fn(),
};

describe('LayerNode inline edit', () => {
  it('renders static text when not editing', () => {
    const layer = createLayer('text', { value: 'Hola' });
    render(
      <LayerNode layer={layer} selected interactive scale={1} editing={false} {...baseHandlers} />,
    );
    expect(screen.getByText('Hola')).toBeTruthy();
    expect(screen.queryByTestId('canvas-inline-editor')).toBeNull();
  });

  it('calls onStartEdit on double-click for text layers', () => {
    const layer = createLayer('text', { value: 'Hola' });
    const onStartEdit = vi.fn();
    render(
      <LayerNode
        layer={layer}
        selected
        interactive
        scale={1}
        editing={false}
        onStartEdit={onStartEdit}
        {...baseHandlers}
      />,
    );
    fireEvent.doubleClick(screen.getByRole('button'));
    expect(onStartEdit).toHaveBeenCalledWith(layer.id);
  });

  it('calls onStartEdit on double-click for field layers (binding focus)', () => {
    const layer = createLayer('field');
    const onStartEdit = vi.fn();
    render(
      <LayerNode
        layer={layer}
        selected
        interactive
        scale={1}
        editing={false}
        onStartEdit={onStartEdit}
        {...baseHandlers}
      />,
    );
    fireEvent.doubleClick(screen.getByRole('button'));
    expect(onStartEdit).toHaveBeenCalledWith(layer.id);
  });

  it('renders field fallback with layer typography (not monospace chrome)', () => {
    const base = createLayer('field');
    const layer = createLayer('field', {
      meta: { key: 'NIS', fallback: 'Sample' },
      cssVars: {
        ...base.cssVars,
        '--font-size': '14pt',
        '--font-family': 'Georgia, serif',
        '--line-height': '1.4',
        '--text-align': 'right',
      },
    });
    const { container } = render(
      <LayerNode layer={layer} selected interactive scale={1} editing={false} {...baseHandlers} />,
    );
    expect(screen.getByText('Sample')).toBeTruthy();
    const node = container.querySelector('[data-layer-id]') as HTMLElement;
    expect(node.style.justifyContent).toBe('flex-end');
    expect(node.style.fontFamily).toContain('Georgia');
    const span = node.querySelector('span') as HTMLElement;
    expect(span.style.lineHeight).toBe('1.4');
    expect(span.style.fontFamily).not.toContain('monospace');
    expect(node.style.fontFamily).not.toContain('monospace');
  });

  it('renders textarea while editing and reports value changes', () => {
    const layer = createLayer('text', { value: 'Hola' });
    const onEditValue = vi.fn();
    const onCommitEdit = vi.fn();
    render(
      <LayerNode
        layer={layer}
        selected
        interactive
        scale={1}
        editing
        onEditValue={onEditValue}
        onCommitEdit={onCommitEdit}
        {...baseHandlers}
      />,
    );
    const editor = screen.getByTestId('canvas-inline-editor') as HTMLTextAreaElement;
    expect(editor.value).toBe('Hola');
    expect(editor.getAttribute('spellcheck')).toBe('false');
    fireEvent.change(editor, { target: { value: 'Mundo' } });
    expect(onEditValue).toHaveBeenCalledWith(layer.id, 'Mundo', expect.any(Number));
  });

  it('commits on Escape and does not start drag from the editor', () => {
    const layer = createLayer('text', { value: 'Hola' });
    const onCommitEdit = vi.fn();
    const onFitTextHeight = vi.fn();
    const onLayerPointerDown = vi.fn();
    render(
      <LayerNode
        layer={layer}
        selected
        interactive
        scale={1}
        editing
        onCommitEdit={onCommitEdit}
        onFitTextHeight={onFitTextHeight}
        onSelect={baseHandlers.onSelect}
        onLayerPointerDown={onLayerPointerDown}
      />,
    );
    const editor = screen.getByTestId('canvas-inline-editor');
    fireEvent.pointerDown(editor);
    expect(onLayerPointerDown).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(onFitTextHeight).toHaveBeenCalledWith(layer.id, expect.any(Number));
    expect(onCommitEdit).toHaveBeenCalled();
  });

  it('commits on Ctrl+D so window duplicate can run', () => {
    const layer = createLayer('text', { value: 'Hola' });
    const onCommitEdit = vi.fn();
    const onFitTextHeight = vi.fn();
    render(
      <LayerNode
        layer={layer}
        selected
        interactive
        scale={1}
        editing
        onCommitEdit={onCommitEdit}
        onFitTextHeight={onFitTextHeight}
        {...baseHandlers}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('canvas-inline-editor'), {
      key: 'd',
      code: 'KeyD',
      ctrlKey: true,
    });
    expect(onFitTextHeight).toHaveBeenCalledWith(layer.id, expect.any(Number));
    expect(onCommitEdit).toHaveBeenCalled();
  });

  it('uses move cursor for text when not editing', () => {
    const layer = createLayer('text', { value: 'Hola' });
    const { container } = render(
      <LayerNode layer={layer} selected interactive scale={1} editing={false} {...baseHandlers} />,
    );
    const node = container.querySelector('[data-layer-id]') as HTMLElement;
    expect(node.style.cursor).toBe('move');
  });

  it('uses text cursor while inline editing', () => {
    const layer = createLayer('text', { value: 'Hola' });
    const { container } = render(
      <LayerNode
        layer={layer}
        selected
        interactive
        scale={1}
        editing
        onCommitEdit={vi.fn()}
        {...baseHandlers}
      />,
    );
    const node = container.querySelector('[data-layer-id]') as HTMLElement;
    expect(node.style.cursor).toBe('text');
  });

  it('uses move cursor for field layers when not editing', () => {
    const layer = createLayer('field');
    const { container } = render(
      <LayerNode layer={layer} selected interactive scale={1} editing={false} {...baseHandlers} />,
    );
    const node = container.querySelector('[data-layer-id]') as HTMLElement;
    expect(node.style.cursor).toBe('move');
  });

  it('puts caret at end when editingSelectAll is false', () => {
    const layer = createLayer('text', { value: 'Hi' });
    render(
      <LayerNode
        layer={layer}
        selected
        interactive
        scale={1}
        editing
        editingSelectAll={false}
        {...baseHandlers}
      />,
    );
    const editor = screen.getByTestId('canvas-inline-editor') as HTMLTextAreaElement;
    expect(editor.selectionStart).toBe(2);
    expect(editor.selectionEnd).toBe(2);
  });

  it('applies line-height and right-align from cssVars', () => {
    const layer = createLayer('text', {
      value: 'Hi',
      cssVars: {
        ...createLayer('text').cssVars,
        '--line-height': '1.5',
        '--text-align': 'right',
      },
    });
    const { container } = render(
      <LayerNode layer={layer} selected interactive scale={1} editing={false} {...baseHandlers} />,
    );
    const node = container.querySelector('[data-layer-id]') as HTMLElement;
    expect(node.style.justifyContent).toBe('flex-end');
    const span = node.querySelector('span') as HTMLElement;
    expect(span.style.lineHeight).toBe('1.5');
  });

  it('renders checkbox / signature / table previews aligned with export', () => {
    const checkbox = createLayer('checkbox', { meta: { checked: true } });
    const { rerender, container } = render(
      <LayerNode layer={checkbox} selected interactive scale={1} editing={false} {...baseHandlers} />,
    );
    expect(screen.getByTestId('canvas-checkbox-mark').textContent).toBe('✓');

    const signature = createLayer('signature', { value: 'Ana Ruiz' });
    rerender(
      <LayerNode layer={signature} selected interactive scale={1} editing={false} {...baseHandlers} />,
    );
    expect(screen.getByTestId('canvas-signature-preview').textContent).toContain('Ana Ruiz');

    const table = createLayer('table');
    rerender(
      <LayerNode layer={table} selected interactive scale={1} editing={false} {...baseHandlers} />,
    );
    expect(screen.getByTestId('canvas-table-preview').querySelectorAll('td').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('Tabla');
  });
});
