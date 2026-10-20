import { FileText, FolderOpen, Puzzle, UserRound, X } from 'lucide-react';
import type { AgentContext } from '../../api/agentApi';

const CHIP = 'flex max-w-[45%] items-center gap-1 rounded-full bg-[var(--bg-input)] py-0.5 pl-2 text-[11px] text-[var(--text-secondary)]';

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function formatTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1).replace('.', ',')} k` : String(value);
}

export default function ContextChips({ context, usage, onRemoveFile }: {
  context: AgentContext | null;
  usage: { input: number; output: number } | null;
  onRemoveFile: (path: string) => void;
}) {
  const modules = context?.modules ?? [];
  const files = context?.files ?? [];
  const accounts = context?.accounts ?? [];
  if (!modules.length && !files.length && !accounts.length && !usage) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pt-2" aria-label="Contexto de la conversación">
      {modules.map((module) => (
        <span key={module.id} className={`${CHIP} pr-2`} title={`Módulo: ${module.label}`}>
          <Puzzle size={11} className="shrink-0" />
          <span className="truncate">{module.label}</span>
        </span>
      ))}
      {files.map((file) => (
        <span key={file.path} className={`${CHIP} pr-1`} title={file.path}>
          {file.folder ? <FolderOpen size={11} className="shrink-0" /> : <FileText size={11} className="shrink-0" />}
          <span className="truncate">{baseName(file.path)}</span>
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
      {usage && (
        <span className="ml-auto text-[10px] tabular-nums text-[var(--text-muted)]" title="Tokens informados por el proveedor (entrada / salida)">
          {formatTokens(usage.input)} / {formatTokens(usage.output)} tokens
        </span>
      )}
    </div>
  );
}
