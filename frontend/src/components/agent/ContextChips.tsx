import { FileText, FolderOpen, FolderRoot, Puzzle, UserRound, X } from 'lucide-react';
import type { AgentContext } from '../../api/agentApi';

const CHIP = 'flex max-w-[45%] items-center gap-1 rounded-full bg-[var(--bg-input)] py-0.5 pl-2 text-[11px] text-[var(--text-secondary)]';

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export default function ContextChips({ context, onRemoveFile, onSetWorkspace }: {
  context: AgentContext | null;
  onRemoveFile: (path: string) => void;
  onSetWorkspace: (path: string) => void;
}) {
  const modules = context?.modules ?? [];
  const files = context?.files ?? [];
  const accounts = context?.accounts ?? [];
  const workspace = context?.workspace ?? null;
  const hasFolders = files.some((file) => file.folder);
  if (!modules.length && !files.length && !accounts.length && !workspace) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pt-2" aria-label="Contexto de la conversación">
      {(workspace || hasFolders) && (
        <span
          className={`${CHIP} pr-2 font-medium text-[var(--text-primary)]`}
          title={workspace ? `Espacio de trabajo: ${workspace}` : 'Sin carpeta activa: el agente trabaja en sus borradores'}
          aria-label="Espacio de trabajo activo"
        >
          <FolderRoot size={11} className="shrink-0" />
          <span className="truncate">{workspace ? baseName(workspace) : 'Borradores'}</span>
        </span>
      )}
      {modules.map((module) => (
        <span key={module.id} className={`${CHIP} pr-2`} title={`Módulo: ${module.label}`}>
          <Puzzle size={11} className="shrink-0" />
          <span className="truncate">{module.label}</span>
        </span>
      ))}
      {files.map((file) => (
        <span key={file.path} className={`${CHIP} pr-1`} title={file.path}>
          {file.folder && file.path !== workspace ? (
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 transition-colors hover:text-[var(--text-primary)]"
              aria-label={`Usar ${baseName(file.path)} como espacio de trabajo`}
              title="Usar esta carpeta como espacio de trabajo"
              onClick={() => onSetWorkspace(file.path)}
            >
              <FolderOpen size={11} className="shrink-0" />
              <span className="truncate">{baseName(file.path)}</span>
            </button>
          ) : (
            <>
              {file.folder ? <FolderOpen size={11} className="shrink-0" /> : <FileText size={11} className="shrink-0" />}
              <span className="truncate">{baseName(file.path)}</span>
            </>
          )}
          <button
            type="button"
            className="rounded-full p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            aria-label={`Retirar acceso a ${baseName(file.path)}`}
            title="Retirar el acceso del agente a este archivo"
            onClick={() => onRemoveFile(file.path)}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {accounts.map((account) => (
        <span key={account} className={`${CHIP} pr-2`} title={`Cuenta usada en aprobaciones: ${account}`}>
          <UserRound size={11} className="shrink-0" />
          <span className="truncate">{account}</span>
        </span>
      ))}
    </div>
  );
}
