// Tarjeta punteada que orienta cuando el lienzo del editor está vacío.
export default function EmptyCanvasHint() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="rounded-xl border border-dashed border-[var(--border-medium)] bg-[var(--bg-elevated)] px-6 py-5 text-center">
        <div className="text-sm font-medium text-[var(--text-primary)]">Lienzo vacío</div>
        <div className="mt-1 text-xs text-[var(--text-secondary)]">
          Arrastra un nodo desde la paleta o haz clic en un tipo.
        </div>
      </div>
    </div>
  );
}
