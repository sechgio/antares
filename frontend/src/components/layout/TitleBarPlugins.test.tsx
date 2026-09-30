import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import TitleBarPlugins from './TitleBarPlugins';
import { setPluginEnabled, setPluginOrder } from '../../plugins';

vi.mock('./radio/RadioWidget', () => ({
  default: () => <div data-testid="radio-widget" />,
}));
vi.mock('./spotify/SpotifyWidget', () => ({
  default: () => <div data-testid="spotify-widget" />,
}));
vi.mock('./audius/AudiusWidget', () => ({
  default: () => <div data-testid="audius-widget" />,
}));
vi.mock('./streaming/JamendoWidget', () => ({
  default: () => <div data-testid="jamendo-widget" />,
}));
vi.mock('./streaming/ArchiveWidget', () => ({
  default: () => <div data-testid="archive-widget" />,
}));

afterEach(() => {
  localStorage.clear();
});

function slotOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-testid^="titlebar-plugin-"]')].map((el) =>
    el.getAttribute('data-testid')!.replace('titlebar-plugin-', ''),
  );
}

describe('TitleBarPlugins', () => {
  it('renders only the enabled plugins as sortable slots', async () => {
    const { container } = render(<TitleBarPlugins />);

    await screen.findByTestId('radio-widget');
    expect(slotOrder(container)).toEqual(['radio-live']);
    expect(screen.queryByTestId('spotify-widget')).toBeNull();
    expect(screen.queryByTestId('audius-widget')).toBeNull();
  });

  it('renders the stored order and re-renders when it changes', async () => {
    act(() => {
      setPluginEnabled('spotify', true);
      setPluginEnabled('audius', true);
      setPluginOrder(['audius', 'spotify', 'radio-live']);
    });

    const { container } = render(<TitleBarPlugins />);
    await screen.findByTestId('audius-widget');
    await screen.findByTestId('spotify-widget');
    await screen.findByTestId('radio-widget');
    expect(slotOrder(container)).toEqual(['audius', 'spotify', 'radio-live']);

    act(() => {
      setPluginOrder(['spotify', 'audius', 'radio-live']);
    });
    expect(slotOrder(container)).toEqual(['spotify', 'audius', 'radio-live']);
  });

  it('marks each slot as a keyboard-operable sortable item', async () => {
    const { container } = render(<TitleBarPlugins />);
    await screen.findByTestId('radio-widget');

    const slot = container.querySelector('[data-testid="titlebar-plugin-radio-live"]')!;
    expect(slot).toHaveAttribute('role', 'button');
    expect(slot).toHaveAttribute('tabindex', '0');
  });
});
