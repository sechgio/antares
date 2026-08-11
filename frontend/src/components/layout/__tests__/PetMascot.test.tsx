import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PetMascot from '../PetMascot';

describe('PetMascot', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders nothing when disabled', () => {
    localStorage.setItem('petdex_enabled', 'false');
    const { container } = render(<PetMascot />);
    expect(container.firstChild).toBeNull();
  });

  it('renders mascot container and sprite sheet when enabled', async () => {
    localStorage.setItem('petdex_enabled', 'true');
    localStorage.setItem('petdex_pet_spritesheet', 'https://assets.petdex.dev/pets/belayer-cat-7fa042c8b542/sprite.webp');
    localStorage.setItem('petdex_scale', '1.25');
    localStorage.setItem('petdex_opacity', '80');

    render(<PetMascot />);

    const mascot = await screen.findByTestId('pet-mascot-container');
    expect(mascot).toBeInTheDocument();
    expect(mascot.className).toContain('z-[90]');
    expect(mascot.style.opacity).toBe('0.8');
    expect(mascot.style.width).toBe(`${192 * 1.25}px`);
  });

  it('triggers reaction animation on mouse hover', async () => {
    localStorage.setItem('petdex_enabled', 'true');
    localStorage.setItem('petdex_pet_spritesheet', 'https://assets.petdex.dev/pets/belayer-cat-7fa042c8b542/sprite.webp');

    render(<PetMascot />);

    const mascot = await screen.findByTestId('pet-mascot-container');
    
    // Hover over mascot
    fireEvent.mouseEnter(mascot);

    // Bounding div transitions to reflecting reacting state (row 3, which translates to background-position-y of -624px)
    await waitFor(() => {
      const sprite = mascot.firstChild as HTMLDivElement;
      expect(sprite.style.backgroundPosition).toContain('-624px');
    });
  });

  it('triggers jump animation on click', async () => {
    localStorage.setItem('petdex_enabled', 'true');
    localStorage.setItem('petdex_pet_spritesheet', 'https://assets.petdex.dev/pets/belayer-cat-7fa042c8b542/sprite.webp');

    render(<PetMascot />);

    const mascot = await screen.findByTestId('pet-mascot-container');

    // Click mascot
    fireEvent.click(mascot);

    // Bounding div transitions to reflecting clicked state (row 4, which translates to background-position-y of -832px)
    await waitFor(() => {
      const sprite = mascot.firstChild as HTMLDivElement;
      expect(sprite.style.backgroundPosition).toContain('-832px');
    });
  });

  it('moves mascot when dragged and persists position', async () => {
    localStorage.setItem('petdex_enabled', 'true');
    localStorage.setItem('petdex_pet_spritesheet', 'https://assets.petdex.dev/pets/belayer-cat-7fa042c8b542/sprite.webp');
    localStorage.setItem('petdex_movement', 'static');

    render(<PetMascot />);

    const mascot = await screen.findByTestId('pet-mascot-container');
    const initialTransform = mascot.style.transform;

    fireEvent.pointerDown(mascot, { clientX: 120, clientY: 120, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 180, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 180, pointerId: 1 });

    await waitFor(() => {
      expect(mascot.style.transform).not.toBe(initialTransform);
    });

    expect(localStorage.getItem('petdex_pos_x')).toBeTruthy();
    expect(localStorage.getItem('petdex_pos_y')).toBeTruthy();
  });

  it('does not trigger jump animation when drag ends', async () => {
    localStorage.setItem('petdex_enabled', 'true');
    localStorage.setItem('petdex_pet_spritesheet', 'https://assets.petdex.dev/pets/belayer-cat-7fa042c8b542/sprite.webp');
    localStorage.setItem('petdex_movement', 'static');

    render(<PetMascot />);

    const mascot = await screen.findByTestId('pet-mascot-container');

    fireEvent.pointerDown(mascot, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.click(mascot);

    const sprite = mascot.firstChild as HTMLDivElement;
    expect(sprite.style.backgroundPosition).not.toContain('-832px');
  });

  it('reloads config when petdex-config-changed fires', async () => {
    localStorage.setItem('petdex_enabled', 'true');
    localStorage.setItem('petdex_pet_spritesheet', 'https://assets.petdex.dev/pets/belayer-cat-7fa042c8b542/sprite.webp');
    localStorage.setItem('petdex_scale', '1');

    render(<PetMascot />);

    const mascot = await screen.findByTestId('pet-mascot-container');
    expect(mascot.style.width).toBe('192px');

    localStorage.setItem('petdex_scale', '1.5');
    window.dispatchEvent(new Event('petdex-config-changed'));

    await waitFor(() => {
      expect(mascot.style.width).toBe(`${192 * 1.5}px`);
    });
  });
});
