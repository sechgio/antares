import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TemplatesSection from '../editor/TemplatesSection';
import {
  getPresetLabel,
  setPresetLabel,
  resetPresetLabel,
  resolvePresetLabels,
} from '../ops/presetLabels';

describe('presetLabels', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getPresetLabel falls back to original when no custom label', () => {
    expect(getPresetLabel('report', 'Panel fotográfico')).toBe('Panel fotográfico');
  });

  it('setPresetLabel persists and getPresetLabel reads it back', () => {
    setPresetLabel('report', 'Mi panel');
    expect(getPresetLabel('report', 'Panel fotográfico')).toBe('Mi panel');
  });

  it('resetPresetLabel removes the custom label', () => {
    setPresetLabel('report', 'Mi panel');
    resetPresetLabel('report');
    expect(getPresetLabel('report', 'Panel fotográfico')).toBe('Panel fotográfico');
  });

  it('resolvePresetLabels mixes custom and original labels', () => {
    setPresetLabel('report', 'Mi panel');
    const resolved = resolvePresetLabels([
      { id: 'report', label: 'Panel fotográfico' },
      { id: 'emergencias', label: 'Emergencias' },
    ]);
    expect(resolved).toEqual([
      { id: 'report', label: 'Mi panel' },
      { id: 'emergencias', label: 'Emergencias' },
    ]);
  });
});

describe('TemplatesSection rename', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows presets and allows applying them', async () => {
    const onApplyPreset = vi.fn();
    render(<TemplatesSection onApplyPreset={onApplyPreset} />);

    const section = screen.getByTestId('canvas-templates-section');
    fireEvent.mouseEnter(section);

    const button = await screen.findByLabelText('Aplicar plantilla Panel fotográfico');
    fireEvent.click(button);
    expect(onApplyPreset).toHaveBeenCalledWith('report');
  });

  it('double-click enters rename mode and Enter commits the new label', async () => {
    const onApplyPreset = vi.fn();
    render(<TemplatesSection onApplyPreset={onApplyPreset} />);

    const section = screen.getByTestId('canvas-templates-section');
    fireEvent.mouseEnter(section);

    const button = await screen.findByLabelText('Aplicar plantilla Panel fotográfico');
    fireEvent.doubleClick(button);

    const input = await screen.findByLabelText('Renombrar plantilla Panel fotográfico');
    fireEvent.change(input, { target: { value: 'Mi panel' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Label persisted to localStorage
    expect(JSON.parse(localStorage.getItem('antares.canvas.presetLabels')!)).toEqual({
      report: 'Mi panel',
    });

    // After commit, the renamed label is shown
    expect(await screen.findByText('Mi panel')).toBeTruthy();
  });

  it('Escape cancels rename without persisting', async () => {
    const onApplyPreset = vi.fn();
    render(<TemplatesSection onApplyPreset={onApplyPreset} />);

    const section = screen.getByTestId('canvas-templates-section');
    fireEvent.mouseEnter(section);

    const button = await screen.findByLabelText('Aplicar plantilla Panel fotográfico');
    fireEvent.doubleClick(button);

    const input = await screen.findByLabelText('Renombrar plantilla Panel fotográfico');
    fireEvent.change(input, { target: { value: 'Mi panel' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(localStorage.getItem('antares.canvas.presetLabels')).toBeNull();
    expect(screen.getByText('Panel fotográfico')).toBeTruthy();
  });

  it('blur commits the rename', async () => {
    const onApplyPreset = vi.fn();
    render(<TemplatesSection onApplyPreset={onApplyPreset} />);

    const section = screen.getByTestId('canvas-templates-section');
    fireEvent.mouseEnter(section);

    const button = await screen.findByLabelText('Aplicar plantilla Panel fotográfico');
    fireEvent.doubleClick(button);

    const input = await screen.findByLabelText('Renombrar plantilla Panel fotográfico');
    fireEvent.change(input, { target: { value: 'Panel custom' } });
    fireEvent.blur(input);

    expect(JSON.parse(localStorage.getItem('antares.canvas.presetLabels')!)).toEqual({
      report: 'Panel custom',
    });
  });

  it('shows reset button for renamed presets and restores original label', async () => {
    const onApplyPreset = vi.fn();
    render(<TemplatesSection onApplyPreset={onApplyPreset} />);

    const section = screen.getByTestId('canvas-templates-section');
    fireEvent.mouseEnter(section);

    const button = await screen.findByLabelText('Aplicar plantilla Panel fotográfico');
    fireEvent.doubleClick(button);

    const input = await screen.findByLabelText('Renombrar plantilla Panel fotográfico');
    fireEvent.change(input, { target: { value: 'Mi panel' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const resetBtn = screen.getByTestId('canvas-reset-preset-report');
    fireEvent.click(resetBtn);

    expect(localStorage.getItem('antares.canvas.presetLabels')).toBeNull();
    expect(screen.getByText('Panel fotográfico')).toBeTruthy();
  });

  it('persists renamed label across remounts', async () => {
    const onApplyPreset = vi.fn();
    const { unmount } = render(<TemplatesSection onApplyPreset={onApplyPreset} />);

    let section = screen.getByTestId('canvas-templates-section');
    fireEvent.mouseEnter(section);

    let button = await screen.findByLabelText('Aplicar plantilla Panel fotográfico');
    fireEvent.doubleClick(button);

    let input = await screen.findByLabelText('Renombrar plantilla Panel fotográfico');
    fireEvent.change(input, { target: { value: 'Persistente' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    unmount();

    render(<TemplatesSection onApplyPreset={onApplyPreset} />);
    section = screen.getByTestId('canvas-templates-section');
    fireEvent.mouseEnter(section);

    expect(await screen.findByText('Persistente')).toBeTruthy();
  });
});
