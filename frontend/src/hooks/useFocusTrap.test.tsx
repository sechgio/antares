import { render, screen, fireEvent } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useFocusTrap } from './useFocusTrap';

function FocusTrapFixture() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, open);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      {open && (
        <div ref={containerRef} tabIndex={-1} role="dialog">
          <button type="button">First</button>
          <button type="button" onClick={() => setOpen(false)}>Last</button>
        </div>
      )}
    </>
  );
}

describe('useFocusTrap', () => {
  it('focuses the first control, wraps Tab, and restores focus on close', () => {
    render(<FocusTrapFixture />);
    const opener = screen.getByRole('button', { name: 'Open' });

    opener.focus();
    fireEvent.click(opener);

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.click(last);
    expect(document.activeElement).toBe(opener);
  });
});
