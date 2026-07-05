import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import PetdexView from './PetdexView';

const PETDEX_MANIFEST_URL = 'https://assets.petdex.dev/manifests/petdex-v1.json';

// Mock fetch
const mockPetsManifest = {
  total: 3,
  pets: [
    {
      slug: 'belayer-cat',
      displayName: 'Belayer Cat',
      kind: 'creature',
      submittedBy: '0xdoublemoon',
      spritesheetUrl: 'https://assets.petdex.dev/pets/belayer-cat-7fa042c8b542/sprite.webp',
      petJsonUrl: 'https://assets.petdex.dev/pets/belayer-cat-7fa042c8b542/petjson.json'
    },
    {
      slug: 'lulu-capybara-2',
      displayName: 'Capibara Lulu',
      kind: 'creature',
      submittedBy: 'gitcjp',
      spritesheetUrl: 'https://assets.petdex.dev/pets/lulu-capybara-9f9107636ecc/sprite.webp',
      petJsonUrl: 'https://assets.petdex.dev/pets/lulu-capybara-9f9107636ecc/petjson.json'
    },
    {
      slug: 'test-custom-pet',
      displayName: 'Custom Test Pet',
      kind: 'character',
      submittedBy: 'tester',
      spritesheetUrl: 'https://assets.petdex.dev/pets/test-custom-pet/sprite.webp',
      petJsonUrl: 'https://assets.petdex.dev/pets/test-custom-pet/petjson.json'
    }
  ]
};

describe('PetdexView', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders Petdex settings view and loads pets', async () => {
    // Mock global fetch
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPetsManifest),
      } as Response)
    );

    render(<PetdexView />);

    expect(screen.getByRole('switch', { name: 'Activar mascota' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Buscar mascota...')).toBeInTheDocument();

    // Wait for the custom test pet to load
    await waitFor(() => {
      expect(screen.getByText('Custom Test Pet')).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledWith(PETDEX_MANIFEST_URL);
    expect(screen.getByText('Sincronizado con Petdex')).toBeInTheDocument();
    expect(screen.getByText('3 mascotas disponibles en el catálogo.')).toBeInTheDocument();
  });

  it('filters pets by search query and category', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPetsManifest),
      } as Response)
    );

    render(<PetdexView />);

    await waitFor(() => {
      expect(screen.getByText('Custom Test Pet')).toBeInTheDocument();
    });

    // Search for Capibara
    const searchInput = screen.getByPlaceholderText('Buscar mascota...');
    fireEvent.change(searchInput, { target: { value: 'Capibara' } });

    expect(screen.queryByText('Custom Test Pet')).not.toBeInTheDocument();
    expect(screen.getByText('Capibara Lulu')).toBeInTheDocument();
  });

  it('toggles mascot activation and updates localStorage', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPetsManifest),
      } as Response)
    );

    render(<PetdexView />);

    const toggle = screen.getByRole('switch', { name: 'Activar mascota' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('petdex_enabled')).toBe('true');
  });

  it('selects a pet and persists spritesheet to localStorage', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPetsManifest),
      } as Response)
    );

    render(<PetdexView />);

    await waitFor(() => {
      expect(screen.getByText('Custom Test Pet')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Custom Test Pet'));

    expect(localStorage.getItem('petdex_active_pet')).toBe('test-custom-pet');
    expect(localStorage.getItem('petdex_pet_spritesheet')).toBe(
      'https://assets.petdex.dev/pets/test-custom-pet/sprite.webp',
    );
  });

  it('syncs default spritesheet when active pet has no stored spritesheet', async () => {
    localStorage.setItem('petdex_active_pet', 'belayer-cat');

    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPetsManifest),
      } as Response)
    );

    render(<PetdexView />);

    await waitFor(() => {
      expect(localStorage.getItem('petdex_pet_spritesheet')).toBe(
        'https://assets.petdex.dev/pets/belayer-cat-7fa042c8b542/sprite.webp',
      );
    });
  });

  it('handles customizing scale, opacity and movement settings', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPetsManifest),
      } as Response)
    );

    render(<PetdexView />);

    // Change scale slider
    const scaleSlider = screen.getByLabelText('Escala');
    fireEvent.change(scaleSlider, { target: { value: '1.25' } });
    expect(localStorage.getItem('petdex_scale')).toBe('1.25');

    // Change opacity slider
    const opacitySlider = screen.getByLabelText('Opacidad');
    fireEvent.change(opacitySlider, { target: { value: '70' } });
    expect(localStorage.getItem('petdex_opacity')).toBe('70');

    // Change movement behavior
    const staticBtn = screen.getByText('Fijo');
    fireEvent.click(staticBtn);
    expect(localStorage.getItem('petdex_movement')).toBe('static');
  });

  it('falls back to offline presets cleanly on network failure', async () => {
    // Mock fetch to reject (offline state)
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.reject(new Error('Network error'))
    );

    render(<PetdexView />);

    // Should display offline warning
    await waitFor(() => {
      expect(screen.getByText('Modo Offline')).toBeInTheDocument();
    });

    // Should display default preset pets
    expect(screen.getAllByText('Belayer Cat').length).toBeGreaterThan(0);
    expect(screen.getByText('Capibara Lulu')).toBeInTheDocument();
    expect(screen.queryByText('Custom Test Pet')).not.toBeInTheDocument();
  });

  it('skips network fetch when manifest cache is still fresh', async () => {
    localStorage.setItem(
      'petdex_manifest_cache',
      JSON.stringify({
        cachedAt: Date.now(),
        pets: mockPetsManifest.pets,
      }),
    );

    const fetchSpy = vi.spyOn(global, 'fetch');

    render(<PetdexView />);

    expect(screen.getByText('Custom Test Pet')).toBeInTheDocument();
    expect(screen.getByText('Sincronizado con Petdex')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores expired manifest cache and fetches again', async () => {
    localStorage.setItem(
      'petdex_manifest_cache',
      JSON.stringify({
        cachedAt: Date.now() - 25 * 60 * 60 * 1000,
        pets: mockPetsManifest.pets,
      }),
    );

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPetsManifest),
      } as Response),
    );

    render(<PetdexView />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(PETDEX_MANIFEST_URL);
    });
  });

  it('uses cached manifest when manual refresh fails', async () => {
    localStorage.setItem(
      'petdex_manifest_cache',
      JSON.stringify({
        cachedAt: Date.now(),
        pets: mockPetsManifest.pets,
      }),
    );

    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.reject(new Error('Network error'))
    );

    render(<PetdexView />);

    expect(screen.getByText('Sincronizado con Petdex')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Recargar catálogo'));

    await waitFor(() => {
      expect(screen.getByText('Catálogo en caché')).toBeInTheDocument();
    });

    expect(screen.getByText('Custom Test Pet')).toBeInTheDocument();
    expect(screen.queryByText('Modo Offline')).not.toBeInTheDocument();
  });
});
