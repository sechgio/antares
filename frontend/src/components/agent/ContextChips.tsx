import { FileImage, FileSpreadsheet, FileText, FolderOpen, FolderRoot, Paperclip, Puzzle, UserRound, X } from 'lucide-react';
import type { AgentContext } from '../../api/agentApi';

const CHIP = 'flex max-w-[45%] items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 pl-2 text-[12px] text-[var(--text-secondary)]';

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

const tint = (color: string) => `bg-[color-mix(in_srgb,var(${color})_14%,transparent)] text-[var(${color})]`;

function fileKind(path: string, folder: boolean) {
  if (folder) return { Icon: FolderOpen, label: 'Carpeta', tone: tint('--accent-yellow') };
  const extension = (/\.([\p{L}\p{N}]{1,5})$/u.exec(path)?.[1] ?? '').toLowerCase();
  if (['xlsx', 'xls', 'csv', 'ods'].includes(extension)) return { Icon: FileSpreadsheet, label: 'Hoja de cálculo', tone: tint('--accent-green') };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return { Icon: FileImage, label: 'Imagen', tone: tint('--accent-blue') };
  if (extension === 'pdf') return { Icon: FileText, label: 'PDF', tone: tint('--accent-red') };
  if (['doc', 'docx', 'txt', 'md'].includes(extension)) return { Icon: FileText, label: 'Documento', tone: tint('--accent-blue') };
  return { Icon: Paperclip, label: extension ? extension.toUpperCase() : 'Archivo', tone: 'bg-[var(--bg-input)] text-[var(--text-secondary)]' };
}

function FileCard({ path, folder }: { path: string; folder: boolean }) {
  const { Icon, label, tone } = fileKind(path, folder);
  return (
    <>
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tone}`} aria-hidden="true">
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-col text-left leading-tight">
        <span className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">{baseName(path)}</span>
        <span className="truncate text-[11px] text-[var(--text-muted)]">{label}</span>
      </span>
    </>
  );
}

export default function ContextChips({ context, onRemoveFile, onSetWorkspace }: {
  context: AgentContext | null;
  onRemoveFile: (path: string) => void;
  onSetWorkspace: (path: string) => void;
}) {
  const modules = context?.modules ?? [];
  const workspace = context?.workspace ?? null;
  const files = (context?.files ?? []).filter((file) => file.path !== workspace);
  const accounts = context?.accounts ?? [];
  const hasFolders = files.some((file) => file.folder);
  if (!modules.length && !files.length && !accounts.length) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-1 pb-2" aria-label="Contexto de la conversación">
      {!workspace && hasFolders && (
        <span
          className={`${CHIP} pr-2 font-medium text-[var(--text-primary)]`}
          title="Sin carpeta activa: el agente trabaja en sus borradores"
          aria-label="Espacio de trabajo activo"
        >
          <FolderRoot size={11} className="shrink-0" />
          <span className="truncate">Borradores</span>
        </span>
      )}
      {modules.map((module) => (
        <span key={module.id} className={`${CHIP} pr-2`} title={`Módulo: ${module.label}`}>
          <Puzzle size={11} className="shrink-0" />
          <span className="truncate">{module.label}</span>
        </span>
      ))}
      {files.map((file) => (
        <span key={file.path} className="flex min-w-0 max-w-[260px] items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1.5 pl-1.5 pr-1" title={file.path}>
          {file.folder ? (
            <button
              type="button"
              className="flex min-w-0 items-center gap-2.5 rounded-lg transition-opacity hover:opacity-80"
              aria-label={`Usar ${baseName(file.path)} como espacio de trabajo`}
              title="Usar esta carpeta como espacio de trabajo"
              onClick={() => onSetWorkspace(file.path)}
            >
              <FileCard path={file.path} folder={file.folder} />
            </button>
          ) : (
            <span className="flex min-w-0 items-center gap-2.5"><FileCard path={file.path} folder={file.folder} /></span>
          )}
          <button
            type="button"
            className="ml-1 shrink-0 self-start rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
            aria-label={`Retirar acceso a ${baseName(file.path)}`}
            title="Retirar el acceso del agente a este archivo"
            onClick={() => onRemoveFile(file.path)}
          >
            <X size={12} />
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
