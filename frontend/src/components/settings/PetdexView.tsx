import { useState, useEffect, useMemo } from 'react';
import { Search, Check, AlertCircle, RefreshCw, ChevronLeft, ChevronRight, PawPrint } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import Toggle from '../ui/Toggle';

interface Pet {
  slug: string;
  displayName: string;
  kind: string;
  submittedBy: string;
  spritesheetUrl: string;
  petJsonUrl: string;
}

type CatalogSource = 'live' | 'cache' | 'presets';

const PETDEX_MANIFEST_URL = 'https://assets.petdex.dev/manifests/petdex-v1.json';
const PETDEX_MANIFEST_CACHE_KEY = 'petdex_manifest_cache';
const MANIFEST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface ManifestCache {
  cachedAt: number;
  pets: Pet[];
}

function isCacheFresh(cachedAt: number) {
  return Date.now() - cachedAt < MANIFEST_CACHE_TTL_MS;
}

function parseManifestPets(data: unknown): Pet[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { pets?: unknown }).pets)) {
    throw new Error('Malformed manifest response');
  }

  return (data as { pets: Array<Record<string, unknown>> }).pets
    .filter((p) => typeof p.slug === 'string' && typeof p.spritesheetUrl === 'string')
    .map((p) => ({
      slug: p.slug as string,
      displayName: (typeof p.displayName === 'string' ? p.displayName : p.slug) as string,
      kind: (typeof p.kind === 'string' ? p.kind : 'unknown') as string,
      submittedBy: (typeof p.submittedBy === 'string' ? p.submittedBy : 'Anonymous') as string,
      spritesheetUrl: p.spritesheetUrl as string,
      petJsonUrl: (typeof p.petJsonUrl === 'string' ? p.petJsonUrl : '') as string,
    }));
}

function readManifestCache(): Pet[] | null {
  try {
    const raw = localStorage.getItem(PETDEX_MANIFEST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ManifestCache;
    if (!Array.isArray(parsed.pets) || parsed.pets.length === 0) return null;
    if (!isCacheFresh(parsed.cachedAt)) {
      localStorage.removeItem(PETDEX_MANIFEST_CACHE_KEY);
      return null;
    }
    return parsed.pets;
  } catch {
    return null;
  }
}

function writeManifestCache(pets: Pet[]) {
  const payload: ManifestCache = { cachedAt: Date.now(), pets };
  localStorage.setItem(PETDEX_MANIFEST_CACHE_KEY, JSON.stringify(payload));
}

const PRESET_PETS: Pet[] = [
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
    slug: 'glitchcat',
    displayName: 'Glitchcat',
    kind: 'creature',
    submittedBy: 'wangm23456',
    spritesheetUrl: 'https://assets.petdex.dev/pets/glitchcat-8cee301bb3ca/sprite.webp',
    petJsonUrl: 'https://assets.petdex.dev/pets/glitchcat-8cee301bb3ca/petjson.json'
  },
  {
    slug: 'wukong-5',
    displayName: 'Wukong',
    kind: 'creature',
    submittedBy: 'jackhanyuan',
    spritesheetUrl: 'https://assets.petdex.dev/pets/wukong-a404dde10313/sprite.webp',
    petJsonUrl: 'https://assets.petdex.dev/pets/wukong-a404dde10313/petjson.json'
  },
  {
    slug: 'subaru-2',
    displayName: 'Awa Subaru',
    kind: 'character',
    submittedBy: 'mytristan',
    spritesheetUrl: 'https://assets.petdex.dev/pets/subaru-7362d1fc6153/sprite.webp',
    petJsonUrl: 'https://assets.petdex.dev/pets/subaru-7362d1fc6153/petjson.json'
  }
];

export default function PetdexView() {
  // Config states persisted to localStorage
  const [enabled, setEnabled] = useState(() => localStorage.getItem('petdex_enabled') === 'true');
  const [activePet, setActivePet] = useState(() => localStorage.getItem('petdex_active_pet') || 'belayer-cat');
  const [scale, setScale] = useState(() => Number(localStorage.getItem('petdex_scale')) || 1.0);
  const [opacity, setOpacity] = useState(() => Number(localStorage.getItem('petdex_opacity')) || 100);
  const [movement, setMovement] = useState<'static' | 'walk'>(() => (localStorage.getItem('petdex_movement') as 'static' | 'walk') || 'walk');

  // API list states
  const initialCache = readManifestCache();
  const [pets, setPets] = useState<Pet[]>(() => initialCache ?? []);
  const [loading, setLoading] = useState(() => initialCache === null);
  const [catalogSource, setCatalogSource] = useState<CatalogSource>(() => (initialCache ? 'live' : 'presets'));

  // Search & filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKind, setSelectedKind] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 36;

  // Animation ticks for previews in settings (0-7 sprite columns)
  const [previewFrame, setPreviewFrame] = useState(0);

  // Sprite preview ticker: ~150ms cadence via a rAF accumulator. Chromium
  // pauses rAF when the window is hidden/minimized, so the panel stops
  // re-rendering in background (setInterval kept ticking). Reduced-motion is
  // checked once per mount (the modal is short-lived).
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let rafId = 0;
    // null hasta el primer frame: la línea base es el primer timestamp de rAF,
    // no el reloj real del mount. Así el acumulador mide solo intervalos
    // frame-a-frame (determinista en tests) y el gap mount→primer frame —que
    // depende de la carga del hilo— nunca cuenta para la cadencia.
    let lastTime: number | null = null;
    let frameAccum = 0;
    const TICK_MS = 150;

    const loop = (time: number) => {
      if (lastTime !== null) {
        const dt = Math.min(Math.max(time - lastTime, 0), 100);
        frameAccum += dt;
        if (frameAccum >= TICK_MS) {
          frameAccum %= TICK_MS;
          setPreviewFrame((f) => (f + 1) % 8);
        }
      }
      lastTime = time;
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Persist settings changes
  const saveSetting = (key: string, value: any) => {
    localStorage.setItem(key, String(value));
  };

  const handleToggleEnabled = (val: boolean) => {
    setEnabled(val);
    saveSetting('petdex_enabled', val);
    // Dispatch a custom event to notify PetMascot immediately
    window.dispatchEvent(new Event('petdex-config-changed'));
  };

  const handleSelectPet = (pet: Pet) => {
    setActivePet(pet.slug);
    saveSetting('petdex_active_pet', pet.slug);
    saveSetting('petdex_pet_spritesheet', pet.spritesheetUrl);
    window.dispatchEvent(new Event('petdex-config-changed'));
  };

  const handleChangeScale = (val: number) => {
    setScale(val);
    saveSetting('petdex_scale', val);
    window.dispatchEvent(new Event('petdex-config-changed'));
  };

  const handleChangeOpacity = (val: number) => {
    setOpacity(val);
    saveSetting('petdex_opacity', val);
    window.dispatchEvent(new Event('petdex-config-changed'));
  };

  const handleChangeMovement = (val: 'static' | 'walk') => {
    setMovement(val);
    saveSetting('petdex_movement', val);
    window.dispatchEvent(new Event('petdex-config-changed'));
  };

  const applyCatalog = (nextPets: Pet[], source: CatalogSource) => {
    setPets(nextPets);
    setCatalogSource(source);
  };

  // Fetch Petdex manifest (redirects to assets.petdex.dev — must be allowed in CSP connect-src)
  const fetchManifest = async () => {
    setLoading(true);
    try {
      const res = await fetch(PETDEX_MANIFEST_URL);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      const apiPets = parseManifestPets(data);
      if (apiPets.length === 0) throw new Error('Manifest returned no pets');

      writeManifestCache(apiPets);
      applyCatalog(apiPets, 'live');
    } catch (err) {
      console.warn('Petdex manifest fetch failed', err);
      const cached = readManifestCache();
      if (cached) {
        applyCatalog(cached, 'cache');
      } else {
        applyCatalog(PRESET_PETS, 'presets');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Fresh cache: show instantly, skip network until user hits refresh
    if (readManifestCache()) return;
    fetchManifest();
  }, []);

  // Keep spritesheet in sync when active pet is set but URL was never persisted
  useEffect(() => {
    if (localStorage.getItem('petdex_pet_spritesheet')) return;
    const pet = pets.find((p) => p.slug === activePet) ?? PRESET_PETS[0];
    saveSetting('petdex_pet_spritesheet', pet.spritesheetUrl);
    window.dispatchEvent(new Event('petdex-config-changed'));
  }, [pets, activePet]);

  // Filter and search logic
  const filteredPets = useMemo(() => {
    return pets.filter((pet) => {
      const matchesSearch =
        pet.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pet.slug.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesKind = selectedKind === 'all' || pet.kind === selectedKind;
      return matchesSearch && matchesKind;
    });
  }, [pets, searchQuery, selectedKind]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedKind]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredPets.length / itemsPerPage) || 1;
  const paginatedPets = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredPets.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredPets, currentPage]);

  const kinds = useMemo(() => {
    const allKinds = new Set<string>();
    pets.forEach((p) => {
      if (p.kind) allKinds.add(p.kind);
    });
    return Array.from(allKinds).sort();
  }, [pets]);

  const activePetData = useMemo(
    () => pets.find((p) => p.slug === activePet) ?? PRESET_PETS.find((p) => p.slug === activePet),
    [pets, activePet],
  );

  const pageStart = filteredPets.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const pageEnd = Math.min(filteredPets.length, currentPage * itemsPerPage);

  const catalogStatus = catalogSource === 'live'
    ? { tone: 'ok' as const, title: 'Sincronizado con Petdex', detail: `${pets.length.toLocaleString()} mascotas disponibles en el catálogo.` }
    : catalogSource === 'cache'
    ? { tone: 'warn' as const, title: 'Catálogo en caché', detail: `Sin conexión a Petdex. Mostrando ${pets.length.toLocaleString()} mascotas guardadas localmente.` }
    : { tone: 'warn' as const, title: 'Modo Offline', detail: 'No se pudo conectar a Petdex. Mostrando mascotas locales por defecto.' };

  return (
    <div className="flex h-full flex-col gap-3 p-4 animate-fade-in text-[var(--text-primary)]">
      {/* Toolbar: enable + compact controls + sync */}
      <div className="shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 pr-3 border-r border-[var(--border-subtle)]">
            <PawPrint size={14} className="text-[var(--accent-primary)]" />
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
              {enabled ? 'Activa' : 'Inactiva'}
            </span>
            <Toggle id="petdex-enabled" aria-label="Activar mascota" checked={enabled} onChange={handleToggleEnabled} />
          </div>

          <div className="flex items-center gap-3 min-w-[140px]">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)] w-12">Escala</span>
            <input
              aria-label="Escala"
              type="range"
              min="0.5"
              max="1.5"
              step="0.25"
              value={scale}
              onChange={(e) => handleChangeScale(Number(e.target.value))}
              className="w-20 accent-[var(--accent-primary)]"
            />
            <span className="font-mono text-[10px] text-[var(--text-muted)] w-8">{scale}x</span>
          </div>

          <div className="flex items-center gap-3 min-w-[140px]">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)] w-12">Opacidad</span>
            <input
              aria-label="Opacidad"
              type="range"
              min="30"
              max="100"
              step="10"
              value={opacity}
              onChange={(e) => handleChangeOpacity(Number(e.target.value))}
              className="w-20 accent-[var(--accent-primary)]"
            />
            <span className="font-mono text-[10px] text-[var(--text-muted)] w-8">{opacity}%</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)] mr-1">Mov.</span>
            {(['static', 'walk'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleChangeMovement(mode)}
                className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                  movement === mode
                    ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {mode === 'static' ? 'Fijo' : 'Caminar'}
              </button>
            ))}
          </div>

          <div
            className={`ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] ${
              catalogStatus.tone === 'ok'
                ? 'text-[var(--accent-green)] bg-[var(--accent-green)]/10'
                : 'text-[var(--accent-yellow)] bg-[var(--accent-yellow)]/10'
            }`}
          >
            {catalogStatus.tone === 'ok' ? <Check size={11} /> : <AlertCircle size={11} />}
            <span className="font-medium">{catalogStatus.title}</span>
            <span className="hidden lg:inline text-[var(--text-muted)]">· {catalogStatus.detail}</span>
          </div>
        </div>
        <p className="sr-only">{catalogStatus.detail}</p>
      </div>

      {/* Search + filters */}
      <div className="shrink-0 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Buscar mascota..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full rounded-md border border-[var(--border-medium)] bg-[var(--bg-surface)] pl-8 pr-3 text-[11px] outline-none focus:border-[var(--accent-primary)]"
          />
        </div>

        <div className="flex items-center gap-1 overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setSelectedKind('all')}
            className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
              selectedKind === 'all'
                ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
                : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Todos
          </button>
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSelectedKind(k)}
              className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-medium capitalize transition-colors ${
                selectedKind === k
                  ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <WithHoverTooltip label="Recargar catálogo" placement="bottom">
          <button
            type="button"
            onClick={fetchManifest}
            aria-label="Recargar catálogo"
            disabled={loading}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </WithHoverTooltip>

        {!loading && pets.length > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
            {filteredPets.length.toLocaleString()}/{pets.length.toLocaleString()}
          </span>
        )}
      </div>

      {/* Catalog grid */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[11px] text-[var(--text-muted)]">
            <RefreshCw size={13} className="animate-spin" />
            Cargando catálogo de Petdex...
          </div>
        ) : filteredPets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <AlertCircle size={20} className="mb-2 text-[var(--text-muted)]" />
            <p className="text-[11px] font-medium text-[var(--text-secondary)]">No se encontraron mascotas</p>
            <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">Prueba con otra palabra clave o categoría</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 p-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {paginatedPets.map((pet) => {
              const isSelected = activePet === pet.slug;
              return (
                <button
                  key={pet.slug}
                  type="button"
                  onClick={() => handleSelectPet(pet)}
                  title={`${pet.displayName} · ${pet.kind}`}
                  className={`group relative flex flex-col items-center rounded-md border p-2 transition-all ${
                    isSelected
                      ? 'border-[var(--accent-primary)] bg-[var(--accent-primary-glow)] ring-1 ring-[var(--accent-primary)]/40'
                      : 'border-transparent bg-[var(--bg-base)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)]">
                      <Check size={9} strokeWidth={3} />
                    </div>
                  )}

                  <div className="relative mb-1.5 h-11 w-11 overflow-hidden rounded bg-[var(--bg-elevated)]">
                    <div
                      style={{
                        width: '192px',
                        height: '208px',
                        backgroundImage: `url(${pet.spritesheetUrl})`,
                        backgroundPosition: `-${previewFrame * 192}px 0px`,
                        transform: 'scale(0.22)',
                        transformOrigin: 'top left',
                        imageRendering: 'pixelated',
                      }}
                      className="absolute left-0 top-0"
                    />
                  </div>

                  <span className="w-full truncate text-center text-[10px] font-medium leading-tight text-[var(--text-primary)]">
                    {pet.displayName}
                  </span>
                  <span className="mt-0.5 w-full truncate text-center text-[9px] text-[var(--text-muted)]">
                    {pet.submittedBy}
                  </span>
                  <span className="mt-1 rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide text-[var(--text-muted)] bg-[var(--bg-elevated)] group-hover:text-[var(--text-secondary)]">
                    {pet.kind}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {!loading && filteredPets.length > 0 && (
        <div className="shrink-0 flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            {activePetData && (
              <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded bg-[var(--bg-elevated)]">
                <div
                  style={{
                    width: '192px',
                    height: '208px',
                    backgroundImage: `url(${activePetData.spritesheetUrl})`,
                    backgroundPosition: '0px 0px',
                    transform: 'scale(0.14)',
                    transformOrigin: 'top left',
                    imageRendering: 'pixelated',
                  }}
                  className="absolute left-0 top-0"
                />
              </div>
            )}
            <span className="truncate text-[10px] text-[var(--text-muted)]">
              {activePetData ? (
                <>
                  <span className="font-medium text-[var(--text-secondary)]">{activePetData.displayName}</span>
                  {' · '}
                </>
              ) : null}
              {pageStart}–{pageEnd} de {filteredPets.length.toLocaleString()}
            </span>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex h-6 w-6 items-center justify-center rounded border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30"
              >
                <ChevronLeft size={12} />
              </button>
              <span className="min-w-[48px] text-center font-mono text-[10px] text-[var(--text-muted)]">
                {currentPage}/{totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="flex h-6 w-6 items-center justify-center rounded border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
