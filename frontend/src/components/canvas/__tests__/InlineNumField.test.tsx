import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InlineNumField from '../editor/InlineNumField';

describe('InlineNumField', () => {
  it('keeps a temporary empty draft and commits a negative decimal', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <InlineNumField prefix="X" value={12} onChange={onChange} onCommit={onCommit} suffix="mm" />,
    );
    const input = screen.getByLabelText('X');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: '-1.5' } });
    expect(onChange).toHaveBeenCalledWith(-1.5);
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('reverts live preview on Escape without committing', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<InlineNumField prefix="Y" value={8} onChange={onChange} onCommit={onCommit} />);
    const input = screen.getByLabelText('Y');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '20' } });
    expect(onChange).toHaveBeenCalledWith(20);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith(8);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('increments by step with arrow keys during editing', () => {
    const onChange = vi.fn();
    render(<InlineNumField prefix="X" value={10} onChange={onChange} step={0.1} />);
    const input = screen.getByLabelText('X');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(10.1);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('does not treat a mixed placeholder as a real value', () => {
    const onChange = vi.fn();
    render(<InlineNumField prefix="W" value={40} mixed onChange={onChange} title="Ancho" />);
    const input = screen.getByLabelText('Ancho');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'Varios');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '12' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(12);
  });

  it('does not write a dummy origin when cancelling a mixed draft', () => {
    const onChange = vi.fn();
    render(<InlineNumField prefix="X" value={0} mixed onChange={onChange} />);
    const input = screen.getByLabelText('X');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
