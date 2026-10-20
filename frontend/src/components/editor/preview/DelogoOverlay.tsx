import { type DelogoRect } from '../types';

/**
 * Overlay de preview rápido del delogo (L5, plan §L5.4).
 *
 * Dibuja las máscaras sobre el preview como regiones semitransparentes.
 * Es una previsualización **rápida y aproximada**: no simula el
 * algoritmo del filtro delogo (que interpola los bordes). La muestra
 * del render final se genera con FFmpeg para revisar el resultado real.
 */
export function DelogoOverlay({
  rects,
  selectedId,
}: {
  rects: DelogoRect[];
  selectedId: string | null;
}) {
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="delogo-overlay">
      {rects.map((rect) => (
        <div
          key={rect.id}
          data-testid={`delogo-rect-${rect.id}`}
          className={`absolute rounded border-2 ${
            rect.id === selectedId
              ? 'border-[var(--accent-primary)] bg-[color:color-mix(in_srgb,var(--accent-primary)_25%,transparent)]'
              : 'border-dashed border-white/70 bg-white/10'
          }`}
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

export default DelogoOverlay;
