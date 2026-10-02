import { NODE_KIND_DEFS, PALETTE_KINDS } from './nodeDefs';
import type { FlowNodeKind } from './types';

export const NODE_DRAG_MIME = 'application/x-antares-flow-node';

export default function NodePalette() {
  return (
    <aside className="flex w-52 shrink-0 flex-col gap-2 overflow-y-auto border-r border-[var(--border-medium)] bg-[var(--bg-base)] p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        Nodos
      </h3>
      <p className="text-[11px] leading-snug text-[var(--text-secondary)]">
        Arrastra un nodo al lienzo para añadirlo.
      </p>
      {PALETTE_KINDS.map((kind: FlowNodeKind) => {
        const def = NODE_KIND_DEFS[kind];
        return (
          <div
            key={kind}
            draggable={def.implemented}
            onDragStart={(e) => {
              e.dataTransfer.setData(NODE_DRAG_MIME, kind);
              e.dataTransfer.effectAllowed = 'move';
            }}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              def.implemented
                ? 'cursor-grab border-[var(--border-medium)] bg-[var(--bg-elevated)] hover:border-[var(--accent-primary)] active:cursor-grabbing'
                : 'cursor-not-allowed border-[var(--border-medium)] bg-[var(--bg-elevated)] opacity-45'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: def.accent }}
              />
              <span className="text-xs font-medium text-[var(--text-primary)]">{def.label}</span>
            </div>
            <div className="mt-0.5 pl-4 text-[10px] text-[var(--text-secondary)]">
              {def.implemented ? def.description : 'Próximamente'}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
