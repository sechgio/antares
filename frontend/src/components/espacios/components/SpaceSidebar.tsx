import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { FolderKanban, Plus } from 'lucide-react';
import type { Espacio, Proyecto } from '../types';
import SidebarNavItem from './SidebarNavItem';

interface SpaceSidebarProps {
  espacios: Espacio[];
  proyectos: Proyecto[];
  activeEspacioId: string | null;
  activeProyectoId: string | null;
  onSelectEspacio: (id: string) => void;
  onSelectProyecto: (id: string) => void;
  onAddEspacio: () => void;
  onAddProyecto: () => void;
  onDeleteEspacio: (id: string) => void;
  onDeleteProyecto: (id: string) => void;
  onRenameEspacio: (id: string, name: string) => void;
  onRenameProyecto: (id: string, name: string) => void;
  onEspacioColorChange: (id: string, color: string) => void;
  onProyectoColorChange: (id: string, color: string) => void;
}

export default function SpaceSidebar({
  espacios,
  proyectos,
  activeEspacioId,
  activeProyectoId,
  onSelectEspacio,
  onSelectProyecto,
  onAddEspacio,
  onAddProyecto,
  onDeleteEspacio,
  onDeleteProyecto,
  onRenameEspacio,
  onRenameProyecto,
  onEspacioColorChange,
  onProyectoColorChange,
}: SpaceSidebarProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-[var(--border-subtle)] px-2.5 py-2.5">
        <ul className="flex flex-col gap-1.5">
          {espacios.map((espacio, index) => (
            <SidebarNavItem
              key={espacio.id}
              name={espacio.name}
              color={espacio.color}
              colorIndex={index}
              isActive={activeEspacioId === espacio.id}
              onSelect={() => onSelectEspacio(espacio.id)}
              onColorChange={(color) => onEspacioColorChange(espacio.id, color)}
              onRename={(name) => onRenameEspacio(espacio.id, name)}
              onDelete={() => onDeleteEspacio(espacio.id)}
              renameLabel={`Renombrar espacio ${espacio.name}`}
              deleteLabel={`Eliminar espacio ${espacio.name}`}
            />
          ))}
          {espacios.length === 0 && (
            <li className="rounded-xl border border-dashed border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/5 px-3 py-5 text-center">
              <div className="relative mx-auto mb-3 flex h-10 w-10 items-center justify-center">
                <div className="absolute inset-0 rounded-xl bg-[var(--accent-primary)]/15 blur-md" />
                <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--accent-primary)]/20 bg-[var(--bg-elevated)]">
                  <FolderKanban className="h-4 w-4 text-[var(--accent-primary-hover)]" />
                </div>
              </div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">Sin espacios aún</p>
              <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
                Tu primer espacio agrupa proyectos y tareas.
              </p>
              <button
                type="button"
                onClick={onAddEspacio}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-2 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)]"
              >
                <Plus className="h-3.5 w-3.5" />
                Crear el primero
              </button>
            </li>
          )}
        </ul>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-2.5 py-3">
        <div className="mb-2 flex items-center justify-between px-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Proyectos
          </span>
          <WithHoverTooltip
            label={activeEspacioId ? 'Nuevo proyecto' : 'Selecciona un espacio primero'}
            placement="right"
          >
            <button
              type="button"
              onClick={onAddProyecto}
              disabled={!activeEspacioId}
              className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Nuevo proyecto"
            >
              <Plus className="h-4 w-4" />
            </button>
          </WithHoverTooltip>
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {proyectos.map((proyecto, index) => (
            <SidebarNavItem
              key={proyecto.id}
              name={proyecto.name}
              color={proyecto.color}
              colorIndex={index + 2}
              isActive={activeProyectoId === proyecto.id}
              icon={<FolderKanban className="h-3.5 w-3.5 shrink-0 opacity-70" />}
              isFavorite={proyecto.is_favorite}
              onSelect={() => onSelectProyecto(proyecto.id)}
              onColorChange={(color) => onProyectoColorChange(proyecto.id, color)}
              onRename={(name) => onRenameProyecto(proyecto.id, name)}
              onDelete={() => onDeleteProyecto(proyecto.id)}
              renameLabel={`Renombrar proyecto ${proyecto.name}`}
              deleteLabel={`Eliminar proyecto ${proyecto.name}`}
            />
          ))}
          {!activeEspacioId && (
            <li className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center">
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                {espacios.length === 0
                  ? 'Los proyectos aparecerán aquí tras crear un espacio.'
                  : 'Selecciona un espacio para ver sus proyectos.'}
              </p>
            </li>
          )}
          {activeEspacioId && proyectos.length === 0 && (
            <li className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center">
              <p className="text-xs text-[var(--text-muted)]">Sin proyectos en este espacio</p>
              <button
                type="button"
                onClick={onAddProyecto}
                className="mt-2 text-xs font-medium text-[var(--accent-primary)] hover:underline"
              >
                Crear proyecto
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
