import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    vi.unstubAllGlobals();
    // Defensa contra fake timers filtrados de otro archivo en el mismo
    // worker: performance.now() real es requisito de la cadencia rAF.
    vi.useRealTimers();
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
    expect(screen.getByText('Catálogo en caché')).toBeInTheDocument();
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

    expect(screen.getByText('Catálogo en caché')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Recargar catálogo' }));

    await waitFor(() => {
      expect(screen.getByText('Catálogo en caché')).toBeInTheDocument();
    });

    expect(screen.getByText('Custom Test Pet')).toBeInTheDocument();
    expect(screen.queryByText('Modo Offline')).not.toBeInTheDocument();
  });

  describe('sprite preview animation', () => {
    function seedFreshCache() {
      localStorage.setItem(
        'petdex_manifest_cache',
        JSON.stringify({ cachedAt: Date.now(), pets: mockPetsManifest.pets }),
      );
    }

    function installRafStub() {
      let pending: FrameRequestCallback | null = null;
      const rafSpy = vi.fn((cb: FrameRequestCallback) => {
        pending = cb;
        return 1;
      });
      vi.stubGlobal('requestAnimationFrame', rafSpy);
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      return {
        rafSpy,
        tick: (time: number) => {
          const cb = pending;
          pending = null;
          act(() => cb?.(time));
        },
      };
    }

    function firstCardSprite(): HTMLElement {
      const card = screen.getByTitle('Belayer Cat · creature');
      const sprite = card.querySelector<HTMLElement>('[style*="background-position"]');
      expect(sprite, 'sprite div with background-position style').toBeTruthy();
      return sprite!;
    }

    it('advances sprite frames on rAF ticks at the 150ms cadence', () => {
      seedFreshCache();
      const raf = installRafStub();

      render(<PetdexView />);

      // Re-consultar el sprite tras cada tanda: si un re-render reemplazara el
      // nodo, una referencia capturada al inicio quedaría detached y el assert
      // leería un estilo congelado (flaky bajo carga).
      const spriteAt = () => {
        const card = screen.getByTitle('Belayer Cat · creature');
        const sprite = card.querySelector<HTMLElement>('[style*="background-position"]');
        expect(sprite, 'sprite div with background-position style').toBeTruthy();
        return sprite!;
      };

      expect(spriteAt().style.backgroundPosition).toContain('0px 0px');

      // El primer tick establece la línea base (lastTime = primer timestamp de
      // rAF); los deltas posteriores de ~16ms acumulan hasta la cadencia.
      let t = performance.now();
      raf.tick(t); // primer frame: baseline, sin acumulación
      for (let i = 0; i < 10; i++) {
        t += 16;
        raf.tick(t);
      }
      expect(spriteAt().style.backgroundPosition).toContain('-192px 0px');

      for (let i = 0; i < 10; i++) {
        t += 16;
        raf.tick(t);
      }
      expect(spriteAt().style.backgroundPosition).toContain('-384px 0px');

      expect(raf.rafSpy).toHaveBeenCalledTimes(22);
    });

    it('keeps previews static under prefers-reduced-motion', () => {
      seedFreshCache();
      vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList);
      const rafSpy = vi.fn(() => 1);
      vi.stubGlobal('requestAnimationFrame', rafSpy);

      render(<PetdexView />);

      const sprite = firstCardSprite();
      expect(sprite.style.backgroundPosition).toContain('0px 0px');
      expect(rafSpy).not.toHaveBeenCalled();
    });
  });
});
