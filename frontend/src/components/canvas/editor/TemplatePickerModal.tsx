import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  ClipboardList,
  Droplets,
  FileText,
  LayoutGrid,
  LayoutTemplate,
  Megaphone,
  Search,
  SearchX,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { loadCanvasPresets, type CanvasPreset } from '../presets/loadPresets';
import {
  PRESET_CATEGORY_LABELS,
  PRESET_CATEGORY_ORDER,
  PRESET_DISTRICTS,
  presetMeta,
  type PresetCategory,
  type PresetDistrict,
} from '../presets/presetCategories';
import BlankCanvasCard from './BlankCanvasCard';
import TemplateCard from './TemplateCard';
import TemplateLightbox from './TemplateLightbox';
import './templatePicker.css';

const CATEGORY_ICONS: Record<PresetCategory | 'all', LucideIcon> = {
  all: LayoutGrid,
  reservorios: Droplets,
  volanteo: Megaphone,
  certificados: BadgeCheck,
  operaciones: ClipboardList,
  general: FileText,
};

interface TemplatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyPreset: (preset: CanvasPreset) => void;
  onNewFromPreset: (preset: CanvasPreset) => void;
  onNewBlank: () => void;
}

export default function TemplatePickerModal({
  isOpen,
  onClose,
  onApplyPreset,
  onNewFromPreset,
  onNewBlank,
}: TemplatePickerModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [presets, setPresets] = useState<ReadonlyArray<CanvasPreset> | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PresetCategory | 'all'>('all');
  const [district, setDistrict] = useState<PresetDistrict | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);

  useFocusTrap(dialogRef, isOpen, searchRef);

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    void loadCanvasPresets().then((list) => {
      if (alive) setPresets(list);
    });
    return () => {
      alive = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (inspectId) setInspectId(null);
      else if (document.activeElement === searchRef.current && query) setQuery('');
      else onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, inspectId, query, onClose]);

  const entries = useMemo(
    () => (presets ?? []).map((preset) => ({ preset, doc: preset.create(preset.label) })),
    [presets],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<PresetCategory, number>();
    for (const { preset } of entries) {
      const key = presetMeta(preset.id).category;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const districtCounts = useMemo(() => {
    const counts = new Map<PresetDistrict, number>();
    for (const { preset } of entries) {
      const key = presetMeta(preset.id).district;
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const normalized = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      entries.filter(({ preset }) => {
        const meta = presetMeta(preset.id);
        if (category !== 'all' && meta.category !== category) return false;
        if (district && meta.district !== district) return false;
        if (!normalized) return true;
        const haystack = [
          preset.label,
          meta.description,
          meta.layout,
          meta.district ?? '',
          PRESET_CATEGORY_LABELS[meta.category],
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalized);
      }),
    [entries, category, district, normalized],
  );

  const hasFilters = Boolean(normalized) || category !== 'all' || district !== null;
  const showBlank = !hasFilters;
  const inspected = inspectId ? entries.find((e) => e.preset.id === inspectId) : undefined;

  const clearFilters = () => {
    setQuery('');
    setCategory('all');
    setDistrict(null);
  };

  const handleCreate = (preset: CanvasPreset) => {
    onNewFromPreset(preset);
    setInspectId(null);
    onClose();
  };

  const handleApply = (preset: CanvasPreset) => {
    onApplyPreset(preset);
    setInspectId(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="canvas-app tpl-overlay z-[120]" role="presentation">
      <div
        ref={dialogRef}
        className="tpl-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tpl-modal-title"
      >
        <header className="tpl-header">
          <span className="tpl-header-icon" aria-hidden="true">
            <LayoutTemplate className="h-3.5 w-3.5" />
          </span>
          <h2 id="tpl-modal-title" className="tpl-title">
            Plantillas
          </h2>
          <span className="tpl-count">{filtered.length}</span>
          <div className="tpl-search">
            <Search className="h-3 w-3" aria-hidden="true" />
            <input
              ref={searchRef}
              className="canvas-input"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar plantillas…"
              aria-label="Buscar plantillas"
              data-testid="tpl-search"
            />
            {query ? (
              <button
                type="button"
                className="tpl-search-clear"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                aria-label="Limpiar búsqueda"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </div>
          <kbd className="canvas-kbd">Esc</kbd>
          <button
            type="button"
            className="canvas-icon-btn"
            onClick={onClose}
            aria-label="Cerrar explorador de plantillas"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="tpl-body">
          <aside className="tpl-rail custom-scrollbar" aria-label="Filtros de plantillas">
            <div className="tpl-rail-group">
              <div className="tpl-rail-label">Categorías</div>
              <button
                type="button"
                className="tpl-nav-item"
                data-active={category === 'all'}
                aria-pressed={category === 'all'}
                onClick={() => setCategory('all')}
              >
                <LayoutGrid className="h-3 w-3" aria-hidden="true" />
                <span className="tpl-nav-label">Todas</span>
                <span className="tpl-nav-count">{presets?.length ?? 0}</span>
              </button>
              {PRESET_CATEGORY_ORDER.map((cat) => {
                const count = categoryCounts.get(cat) ?? 0;
                if (!count) return null;
                const Icon = CATEGORY_ICONS[cat];
                return (
                  <button
                    key={cat}
                    type="button"
                    className="tpl-nav-item"
                    data-active={category === cat}
                    aria-pressed={category === cat}
                    onClick={() => setCategory(category === cat ? 'all' : cat)}
                  >
                    <Icon className="h-3 w-3" aria-hidden="true" />
                    <span className="tpl-nav-label">{PRESET_CATEGORY_LABELS[cat]}</span>
                    <span className="tpl-nav-count">{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="tpl-rail-group">
              <div className="tpl-rail-label">Zona</div>
              {PRESET_DISTRICTS.map((zone) => {
                const count = districtCounts.get(zone) ?? 0;
                if (!count) return null;
                return (
                  <button
                    key={zone}
                    type="button"
                    className="tpl-nav-item"
                    data-active={district === zone}
                    aria-pressed={district === zone}
                    onClick={() => setDistrict(district === zone ? null : zone)}
                  >
                    <span className="tpl-nav-dot" aria-hidden="true" />
                    <span className="tpl-nav-label">{zone}</span>
                    <span className="tpl-nav-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="tpl-content">
            {hasFilters ? (
              <div className="tpl-content-bar">
                <button type="button" className="tpl-clear" onClick={clearFilters}>
                  Limpiar filtros
                </button>
              </div>
            ) : null}
            <div className="tpl-grid custom-scrollbar">
              {presets === null ? (
                <div className="tpl-empty">Cargando plantillas…</div>
              ) : (
                <>
                  {showBlank ? (
                    <BlankCanvasCard
                      onBlank={() => {
                        onNewBlank();
                        onClose();
                      }}
                    />
                  ) : null}
                  {filtered.map(({ preset, doc }) => (
                    <TemplateCard
                      key={preset.id}
                      presetId={preset.id}
                      label={preset.label}
                      meta={presetMeta(preset.id)}
                      document={doc}
                      onInspect={() => setInspectId(preset.id)}
                      onCreate={() => handleCreate(preset)}
                      onApply={() => handleApply(preset)}
                    />
                  ))}
                  {filtered.length === 0 ? (
                    <div className="tpl-empty">
                      <SearchX className="h-4 w-4" aria-hidden="true" />
                      <p>Sin resultados</p>
                      <span>Prueba con otra búsqueda o limpia los filtros.</span>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {inspected ? (
        <TemplateLightbox
          label={inspected.preset.label}
          meta={presetMeta(inspected.preset.id)}
          document={inspected.doc}
          onClose={() => setInspectId(null)}
          onCreate={() => handleCreate(inspected.preset)}
          onApply={() => handleApply(inspected.preset)}
        />
      ) : null}
    </div>
  );
}
