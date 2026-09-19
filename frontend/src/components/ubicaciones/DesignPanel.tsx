import React, { useState } from 'react';
import { ChevronRight, Eye } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import Button from '../ui/Button';
import ThemedSelect from '../ui/ThemedSelect';
import {
  MAP_PROVIDERS,
  MAP_PROVIDER_BY_ID,
  PIN_PRESETS,
  TEXT_FIELDS,
  type CustomStyles,
} from './ubicacionesTypes';

interface DesignPanelProps {
  customStyles: CustomStyles;
  onUpdateStyle: (updater: (prev: CustomStyles) => CustomStyles) => void;
  provider: string;
  onProviderChange: (provider: string) => void;
  apiKeys: Record<string, string>;
  onApiKeyChange: (provider: string, value: string) => void;
  keysConfigured: Record<string, boolean>;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onResetStyles: () => void;
}

export const DesignPanel: React.FC<DesignPanelProps> = ({
  customStyles,
  onUpdateStyle,
  provider,
  onProviderChange,
  apiKeys,
  onApiKeyChange,
  keysConfigured,
  zoom,
  onZoomChange,
  onResetStyles,
}) => {
  const [designOpen, setDesignOpen] = useState(false);
  const [designTab, setDesignTab] = useState<'texts' | 'pin' | 'map'>('texts');

  return (
    <div className="border-t border-[var(--border-subtle)] pt-3">
      <Button variant="none" size="none"
        onClick={() => setDesignOpen(o => !o)}
        className="flex items-center justify-between w-full text-left group"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors">
          Personalización de Diseño
        </span>
        <ChevronRight size={13} className={`text-[var(--text-muted)] transition-transform duration-200 ${designOpen ? 'rotate-90' : ''}`} />
      </Button>

      {designOpen && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-0.5 rounded-lg bg-[var(--bg-input)] p-0.5">
            {(['texts', 'pin', 'map'] as const).map(tab => (
              <Button variant="none" size="none"
                key={tab}
                onClick={() => setDesignTab(tab)}
                className={`flex-1 text-[10px] font-medium py-1 rounded-md transition-all ${
                  designTab === tab
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {tab === 'texts' ? 'Textos' : tab === 'pin' ? 'Pin' : 'Mapa'}
              </Button>
            ))}
          </div>

          {designTab === 'texts' && (
            <div className="space-y-1.5">
              {TEXT_FIELDS.map(f => {
                const style = customStyles.texts[f.key];
                return (
                  <div key={f.key} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-[var(--text-primary)]">{f.label}</span>
                      <div className="flex items-center gap-0.5">
                        <Button variant="none" size="none"
                          onClick={() => onUpdateStyle(s => ({
                            ...s,
                            texts: {
                              ...s.texts,
                              [f.key]: { ...s.texts[f.key], bold: !s.texts[f.key].bold }
                            }
                          }))}
                          className={`w-5 h-5 rounded text-[9px] font-bold transition-all ${style.bold ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_15%,transparent)] text-[var(--accent-primary)]' : 'bg-[var(--bg-input)] text-[var(--text-muted)]'}`}
                        >B</Button>
                        <Button variant="none" size="none"
                          onClick={() => onUpdateStyle(s => ({
                            ...s,
                            texts: {
                              ...s.texts,
                              [f.key]: { ...s.texts[f.key], visible: !s.texts[f.key].visible }
                            }
                          }))}
                          className={`w-5 h-5 rounded flex items-center justify-center transition-all ${style.visible ? 'bg-[color:color-mix(in_srgb,var(--accent-green)_15%,transparent)] text-[var(--accent-green)]' : 'bg-[var(--bg-input)] text-[var(--text-muted)]'}`}
                        ><Eye size={9} /></Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-[var(--text-muted)] w-6 shrink-0">Tam.</span>
                      <input
                        type="range"
                        min={20}
                        max={200}
                        step={5}
                        value={style.fontSize ?? (f.key === 'cod_componente' ? 120 : 60)}
                        onChange={e => onUpdateStyle(s => ({
                          ...s,
                          texts: {
                            ...s.texts,
                            [f.key]: { ...s.texts[f.key], fontSize: +e.target.value }
                          }
                        }))}
                        className="flex-1 h-1 accent-[var(--accent-primary)]"
                      />
                      <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-6 text-right">{style.fontSize ?? (f.key === 'cod_componente' ? 120 : 60)}</span>
                        <input
                          type="color"
                          value={style.color ?? '#000000'}
                          onChange={e => onUpdateStyle(s => ({
                            ...s,
                            texts: {
                              ...s.texts,
                              [f.key]: { ...s.texts[f.key], color: e.target.value }
                            }
                          }))}
                          className="w-5 h-5 p-0 border-none bg-transparent rounded cursor-pointer shrink-0"
                        />
                      </div>

                    <div className="flex gap-4">
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-[9px] text-[var(--text-muted)] shrink-0">X</span>
                        <input
                          type="range"
                          min={-300}
                          max={300}
                          value={style.offsetX ?? 0}
                          onChange={e => onUpdateStyle(s => ({
                            ...s,
                            texts: {
                              ...s.texts,
                              [f.key]: { ...s.texts[f.key], offsetX: +e.target.value }
                            }
                          }))}
                          className="flex-1 h-1 accent-[var(--accent-primary)] min-w-0"
                        />
                        <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-6 text-right shrink-0">{style.offsetX ?? 0}</span>
                      </div>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-[9px] text-[var(--text-muted)] shrink-0">Y</span>
                        <input
                          type="range"
                          min={-300}
                          max={300}
                          value={style.offsetY ?? 0}
                          onChange={e => onUpdateStyle(s => ({
                            ...s,
                            texts: {
                              ...s.texts,
                              [f.key]: { ...s.texts[f.key], offsetY: +e.target.value }
                            }
                          }))}
                          className="flex-1 h-1 accent-[var(--accent-primary)] min-w-0"
                        />
                        <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-6 text-right shrink-0">{style.offsetY ?? 0}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {designTab === 'pin' && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-[var(--text-primary)]">Visibilidad</span>
                <Button variant="none" size="none"
                  onClick={() => onUpdateStyle(s => ({ ...s, pin: { ...s.pin, visible: !s.pin.visible } }))}
                  className={`w-5 h-5 rounded flex items-center justify-center transition-all ${customStyles.pin.visible !== false ? 'bg-[color:color-mix(in_srgb,var(--accent-green)_15%,transparent)] text-[var(--accent-green)]' : 'bg-[var(--bg-input)] text-[var(--text-muted)]'}`}
                >
                  <Eye size={9} />
                </Button>
              </div>

              <div className="space-y-1">
                <span className="text-[9px] text-[var(--text-muted)] block">Color del Pin</span>
                <div className="flex flex-wrap gap-1">
                  {PIN_PRESETS.map((presetColor, idx) => (
                    <WithHoverTooltip
                      key={idx}
                      label={presetColor ? `Color: ${presetColor}` : 'Color original (rojo)'}
                      placement="bottom"
                    >
                      <Button variant="none" size="none"
                        onClick={() => onUpdateStyle(s => ({ ...s, pin: { ...s.pin, color: presetColor } }))}
                        aria-label={presetColor ? `Color: ${presetColor}` : 'Color original (rojo)'}
                        className={`w-4.5 h-4.5 rounded-full border transition-all cursor-pointer ${
                          (customStyles.pin.color ?? '') === presetColor
                            ? 'border-[var(--accent-primary)] scale-110 shadow-sm'
                            : 'border-[var(--border-subtle)] hover:scale-105'
                        }`}
                        style={{ backgroundColor: presetColor || '#4B5563', width: 18, height: 18 }}
                      />
                    </WithHoverTooltip>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[9px] text-[var(--text-muted)] w-7 shrink-0">Escala</span>
                <input
                  type="range"
                  min={0.05}
                  max={0.30}
                  step={0.01}
                  value={customStyles.pin.scale ?? 0.15}
                  onChange={e => onUpdateStyle(s => ({ ...s, pin: { ...s.pin, scale: +e.target.value } }))}
                  className="flex-1 h-1 accent-[var(--accent-primary)]"
                />
                <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-7 text-right">
                  {(customStyles.pin.scale ?? 0.15).toFixed(2)}
                </span>
              </div>

              <div className="flex gap-4">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] shrink-0">X</span>
                  <input
                    type="range"
                    min={-300}
                    max={300}
                    value={customStyles.pin.offsetX ?? 0}
                    onChange={e => onUpdateStyle(s => ({ ...s, pin: { ...s.pin, offsetX: +e.target.value } }))}
                    className="flex-1 h-1 accent-[var(--accent-primary)] min-w-0"
                  />
                  <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-6 text-right shrink-0">
                    {customStyles.pin.offsetX ?? 0}
                  </span>
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] shrink-0">Y</span>
                  <input
                    type="range"
                    min={-300}
                    max={300}
                    value={customStyles.pin.offsetY ?? 0}
                    onChange={e => onUpdateStyle(s => ({ ...s, pin: { ...s.pin, offsetY: +e.target.value } }))}
                    className="flex-1 h-1 accent-[var(--accent-primary)] min-w-0"
                  />
                  <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-6 text-right shrink-0">
                    {customStyles.pin.offsetY ?? 0}
                  </span>
                </div>
              </div>
            </div>
          )}

          {designTab === 'map' && (
            <div className="space-y-1.5">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 space-y-2">
                <span className="text-[10px] font-medium text-[var(--text-primary)] block">Capa y Zoom</span>

                <div className="space-y-0.5">
                  <label className="text-[9px] text-[var(--text-muted)]">Proveedor</label>
                  <ThemedSelect
                    value={provider}
                    onChange={onProviderChange}
                    aria-label="Proveedor de mapa"
                    options={MAP_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                  />
                </div>

                {MAP_PROVIDER_BY_ID[provider]?.needsKey && (
                  <div className="space-y-0.5">
                    <label className="text-[9px] text-[var(--text-muted)] flex justify-between">
                      <span>API Key ({MAP_PROVIDER_BY_ID[provider]?.label ?? provider})</span>
                      {MAP_PROVIDER_BY_ID[provider]?.helpUrl && (
                      <span
                        className="text-[8px] text-[var(--accent-primary)] hover:underline cursor-pointer"
                        onClick={() => {
                          window.open(MAP_PROVIDER_BY_ID[provider].helpUrl, '_blank');
                        }}
                      >
                        ¿Cómo obtenerla?
                      </span>
                      )}
                    </label>
                    <input
                      type="password"
                      value={apiKeys[provider] || ''}
                      onChange={e => onApiKeyChange(provider, e.target.value)}
                      placeholder={
                        keysConfigured[provider]
                          ? 'Clave guardada — escribe una nueva para reemplazarla'
                          : `Pega tu llave de ${MAP_PROVIDER_BY_ID[provider]?.label ?? provider} aquí...`
                      }
                      className="w-full bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[10px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] w-8 shrink-0">Zoom</span>
                  <input
                    type="range"
                    min={12}
                    max={20}
                    step={1}
                    value={zoom}
                    onChange={e => onZoomChange(+e.target.value)}
                    className="flex-1 h-1 accent-[var(--accent-primary)]"
                  />
                  <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-5 text-right">
                    {zoom}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 space-y-1.5">
                <span className="text-[10px] font-medium text-[var(--text-primary)] block">Filtro de Contraste</span>

                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] w-7 shrink-0">Color</span>
                  <input
                    type="color"
                    value={customStyles.map.overlayColor ?? '#F6F6F6'}
                    onChange={e => onUpdateStyle(s => ({ ...s, map: { ...s.map, overlayColor: e.target.value } }))}
                    className="w-5 h-5 rounded border border-[var(--border-subtle)] cursor-pointer"
                  />
                  <span className="text-[9px] text-[var(--text-muted)] font-mono">{customStyles.map.overlayColor ?? '#F6F6F6'}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] w-7 shrink-0">Opacidad</span>
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={customStyles.map.overlayAlpha ?? 120}
                    onChange={e => onUpdateStyle(s => ({ ...s, map: { ...s.map, overlayAlpha: +e.target.value } }))}
                    className="flex-1 h-1 accent-[var(--accent-primary)]"
                  />
                  <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-5 text-right">
                    {customStyles.map.overlayAlpha ?? 120}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 space-y-1.5">
                <span className="text-[10px] font-medium text-[var(--text-primary)] block">Distribución</span>

                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] w-10 shrink-0">Inicio Y</span>
                  <input
                    type="range"
                    min={50}
                    max={400}
                    value={customStyles.layout.yStart ?? 120}
                    onChange={e => onUpdateStyle(s => ({ ...s, layout: { ...s.layout, yStart: +e.target.value } }))}
                    className="flex-1 h-1 accent-[var(--accent-primary)]"
                  />
                  <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-5 text-right">
                    {customStyles.layout.yStart ?? 120}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] w-10 shrink-0">Espaciado</span>
                  <input
                    type="range"
                    min={80}
                    max={400}
                    value={customStyles.layout.lineSpacing ?? 180}
                    onChange={e => onUpdateStyle(s => ({ ...s, layout: { ...s.layout, lineSpacing: +e.target.value } }))}
                    className="flex-1 h-1 accent-[var(--accent-primary)]"
                  />
                  <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-5 text-right">
                    {customStyles.layout.lineSpacing ?? 180}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] w-10 shrink-0">Separación</span>
                  <input
                    type="range"
                    min={0.3}
                    max={1.5}
                    step={0.1}
                    value={customStyles.layout.lineGap ?? 0.7}
                    onChange={e => onUpdateStyle(s => ({ ...s, layout: { ...s.layout, lineGap: +e.target.value } }))}
                    className="flex-1 h-1 accent-[var(--accent-primary)]"
                  />
                  <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-5 text-right">
                    {(customStyles.layout.lineGap ?? 0.7).toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <Button variant="none" size="none"
            onClick={onResetStyles}
            className="w-full text-[9px] text-[var(--text-muted)] hover:text-[var(--accent-red)] py-1 transition-colors"
          >
            Restaurar valores por defecto
          </Button>
        </div>
      )}
    </div>
  );
};
