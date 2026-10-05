import { NODE_KIND_DEFS, PALETTE_KINDS } from './nodeDefs';
import type { FlowNodeKind } from './types';

export const NODE_DRAG_MIME = 'application/x-antares-flow-node';

interface Props {
  onAdd: (kind: FlowNodeKind) => void;
}

export default function NodePalette({ onAdd }: Props) {
  return (
    <aside className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--border-medium)] bg-[var(--bg-base)] p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        Nodos
      </h3>
      <p className="mb-1 text-[11px] leading-snug text-[var(--text-secondary)]">
        Arrastra un nodo al lienzo o haz clic para añadirlo.
      </p>
      {PALETTE_KINDS.map((kind: FlowNodeKind) => {
        const def = NODE_KIND_DEFS[kind];
        const Icon = def.icon;
        return (
          <button
            key={kind}
            type="button"
            draggable={def.implemented}
            disabled={!def.implemented}
            onClick={() => {
              if (def.implemented) onAdd(kind);
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData(NODE_DRAG_MIME, kind);
              e.dataTransfer.effectAllowed = 'move';
            }}
            className={`flex items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left transition-colors ${
              def.implemented
                ? 'cursor-grab hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)] active:cursor-grabbing'
                : 'cursor-not-allowed opacity-45'
            }`}
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: `color-mix(in srgb, ${def.accent} 15%, transparent)`,
                color: def.accent,
              }}
            >
              <Icon size={14} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                {def.label}
                {!def.implemented && (
                  <span className="rounded-[6px] border border-[var(--border-medium)] px-1 text-[8.5px] uppercase tracking-wide text-[var(--text-secondary)]">
                    Pronto
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[10px] leading-snug text-[var(--text-secondary)]">
                {def.implemented ? def.description : 'Aún no se puede ejecutar'}
              </span>
            </span>
          </button>
        );
      })}
    </aside>
  );
}
