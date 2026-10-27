import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Eye, FileText, LayoutTemplate, Printer, Save, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { agentApi, type AgentArtifact } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ThemedSelect from '../ui/ThemedSelect';
import { channelLabel } from './channels';

function ArtifactAction({ label, icon: Icon, title = label, ...props }: {
  label: string; icon: LucideIcon; title?: string; disabled?: boolean; onClick: () => void;
}) {
  return (
    <Button size="none" variant="ghost" aria-label={label} title={title} className="size-8 shrink-0" {...props}>
      <Icon size={15} aria-hidden="true" />
    </Button>
  );
}

const VISIBLE_RESULTS = 2;

export function ArtifactList({ artifacts, sessionId, onRefresh, onOpenModule }: {
  artifacts: AgentArtifact[]; sessionId: string; onRefresh: () => void; onOpenModule?: (module: string, id?: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const hidden = showAll ? 0 : Math.max(0, artifacts.length - VISIBLE_RESULTS);
  return (
    <div role="group" aria-label="Resultados" className="space-y-1.5 pt-1">
      {hidden > 0 && (
        <button type="button" onClick={() => setShowAll(true)}
          className="agent-tool-row flex items-center gap-1.5 px-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <ChevronRight size={13} aria-hidden="true" />
          {hidden === 1 ? 'Mostrar 1 resultado anterior' : `Mostrar ${hidden} resultados anteriores`}
        </button>
      )}
      {artifacts.slice(hidden).map((artifact) => (
        <div key={artifact.id} id={`agent-artifact-${artifact.id}`} className="scroll-mt-4">
          <ArtifactCard artifact={artifact} sessionId={sessionId} onRefresh={onRefresh} onOpenModule={onOpenModule} />
        </div>
      ))}
    </div>
  );
}

export default function ArtifactCard({ artifact, sessionId, onRefresh, onOpenModule }: {
  artifact: AgentArtifact; sessionId: string; onRefresh: () => void; onOpenModule?: (module: string, id?: string) => void;
}) {
  const { addToast } = useToast();
  const [fileIndex, setFileIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState('');
  const [showPrint, setShowPrint] = useState(false);
  const [printers, setPrinters] = useState<{ name: string; default: boolean }[]>([]);
  const [printer, setPrinter] = useState('');
  const [copies, setCopies] = useState('1');
  const [pages, setPages] = useState('');
  const [duplex, setDuplex] = useState('none');
  const [quality, setQuality] = useState('normal');
  const failedPrepare = useRef<{ key: string; requestId: string } | null>(null);
  const file = artifact.files[fileIndex];
  const isReviewed = (reviewed || artifact.reviewed?.[String(fileIndex)]) === file.sha256;
  const receipt = artifact.receipt;
  const receiptText = receipt
    ? receipt.status === 'failed' ? 'Falló'
      : receipt.status === 'submitted' ? 'Enviado'
        : receipt.status === 'uncertain' ? 'Incierto'
          : receipt.approval_source === 'rule' ? 'Permitido por regla'
            : receipt.approval_source === 'web' ? 'Permitido por regla web'
            : receipt.approval_source === 'full' ? 'Permitido por acceso completo'
              : receipt.approval_source === 'manual' ? 'Permitido por ti'
                : receipt.approval_source === 'cancel' ? 'Cancelado' : 'Ejecutado'
    : '';

  const action = async (operation: 'preview' | 'review' | 'open' | 'save' | 'print', requestedPage = page) => {
    if (busy) return;
    setBusy(true);
    const key = JSON.stringify({ operation, fileIndex, printer, copies, pages, duplex, quality });
    const requestId = failedPrepare.current?.key === key ? failedPrepare.current.requestId : crypto.randomUUID();
    try {
      const result = await agentApi.agentArtifactAction({ session_id: sessionId, artifact_id: artifact.id,
        file_index: fileIndex, action: operation, sha256: file.sha256, page: requestedPage,
        request_id: requestId,
        ...(operation === 'print' ? { printer_name: printer, copies: Number(copies), pages, duplex, quality } : {}) });
      failedPrepare.current = null;
      if (result.png_base64) { setPreview(result.png_base64); setPage(requestedPage); }
      if (result.reviewed) setReviewed(file.sha256);
      if (result.approval) addToast({ message: 'Revisa la acción y apruébala en el chat', type: 'info' });
      if (operation !== 'preview') onRefresh();
    } catch (err) {
      if (operation === 'print' || operation === 'save') failedPrepare.current = { key, requestId };
      addToast({ message: errorMessage(err, 'No se pudo abrir el resultado'), type: 'error' });
    } finally { setBusy(false); }
  };

  const selectPrint = async () => {
    setShowPrint((value) => !value);
    if (printers.length) return;
    try {
      const result = await agentApi.agentPrintersList();
      setPrinters(result.printers);
      setPrinter(result.printers.find((item) => item.default)?.name || result.printers[0]?.name || '');
    } catch (err) { addToast({ message: errorMessage(err, 'No se pudieron consultar las impresoras'), type: 'error' }); }
  };

  const module = artifact.module || (artifact.family === 'canvas' ? 'canvas' : artifact.family === 'formato' ? 'formatos' : 'previewPanel');
  const id = ['canvas', 'formato'].includes(artifact.family) || (!artifact.module && artifact.family === 'html')
    ? artifact.template_id : artifact.sources?.find((source) => source.ids?.length)?.ids?.[0];
  return (
    <section aria-label={`Documento ${file.name}`} className="agent-artifact w-full max-w-[min(620px,100%)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 p-2.5">
        <span className="agent-artifact-icon flex size-10 shrink-0 flex-col items-center justify-center rounded-lg" aria-hidden="true">
          <FileText size={16} />
          <span className="text-[8.5px] font-semibold leading-none tracking-wide">PDF</span>
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-[13px] font-medium leading-5 text-[var(--text-primary)]" title={file.name}>{file.name}</p>
          <p className="truncate text-[11.5px] leading-4 text-[var(--text-muted)]">
            {file.pages} pág. · {Math.ceil(file.size / 1024)} KB · <span className={isReviewed ? 'text-[var(--accent-green)]' : ''}>{isReviewed ? 'PDF revisado' : 'Pendiente de revisión'}</span>
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Button size="sm" variant="secondary" disabled={busy} aria-expanded={!!preview}
            onClick={() => { if (preview) setPreview(''); else void action('preview'); }}>
            <Eye size={13} aria-hidden="true" />Vista previa
          </Button>
          <ArtifactAction label="Abrir PDF" icon={ExternalLink} disabled={busy} onClick={() => void action('open')} />
          {onOpenModule && <ArtifactAction label="Abrir módulo" icon={LayoutTemplate} onClick={() => onOpenModule(module, id)} />}
          <ArtifactAction label="Guardar" icon={Save} disabled={busy} onClick={() => void action('save')} />
          <ArtifactAction label="Imprimir" icon={Printer} disabled={busy || !isReviewed} onClick={() => void selectPrint()}
            title={isReviewed ? 'Imprimir' : 'Revisa la vista previa antes de imprimir'} />
        </div>
      </div>
      {(artifact.files.length > 1 || receipt) && <div className="space-y-2 px-2.5 pb-2.5">
        {artifact.files.length > 1 && <ThemedSelect value={String(fileIndex)} aria-label="Archivo del resultado"
          options={artifact.files.map((item, index) => ({ value: String(index), label: item.name }))}
          onChange={(value) => { setFileIndex(Number(value)); setPage(0); setPreview(''); setReviewed(''); }} />}
        {receipt && (
          <div role="group" aria-label="Recibo de la acción"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-[var(--text-muted)]">
            <ShieldCheck size={11} className="shrink-0" aria-hidden="true" />
            <span>{channelLabel(receipt.channel) ?? 'Documentos'}</span>
            <span aria-hidden="true">·</span>
            <span>{receiptText}</span>
            <span>· No reversible</span>
          </div>
        )}
      </div>}
      {preview && <div className="space-y-2 border-t border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5">
        <img src={`data:image/png;base64,${preview}`} alt={`Página ${page + 1} de ${file.name}`} className="max-h-[65vh] w-full object-contain" />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" disabled={busy || page === 0} aria-label="Página anterior" onClick={() => void action('preview', page - 1)}><ChevronLeft size={14} /></Button>
          <span className="text-xs text-[var(--text-secondary)]">{page + 1} / {file.pages}</span>
          <Button size="sm" variant="ghost" disabled={busy || page + 1 >= file.pages} aria-label="Página siguiente" onClick={() => void action('preview', page + 1)}><ChevronRight size={14} /></Button>
          <Button size="sm" disabled={busy || isReviewed} onClick={() => void action('review')}>He revisado este PDF</Button>
        </div>
      </div>}
      {showPrint && <div className="space-y-2 border-t border-[var(--border-subtle)] p-2.5">
        {!printers.length ? <p className="text-xs text-[var(--text-secondary)]">Añade una impresora en Windows para continuar.</p> : <>
          <ThemedSelect value={printer} onChange={setPrinter} aria-label="Impresora" options={printers.map((item) => ({ value: item.name, label: item.name }))} />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" min={1} max={99} value={copies} aria-label="Copias" onChange={(event) => setCopies(event.target.value)} />
            <Input value={pages} placeholder="Todas las páginas (p. ej. 1-3,5)" aria-label="Páginas a imprimir" onChange={(event) => setPages(event.target.value)} />
            <ThemedSelect value={duplex} onChange={setDuplex} aria-label="Dúplex" options={[{ value: 'none', label: 'Una cara' }, { value: 'long_edge', label: 'Dos caras, borde largo' }, { value: 'short_edge', label: 'Dos caras, borde corto' }]} />
            <ThemedSelect value={quality} onChange={setQuality} aria-label="Calidad" options={[{ value: 'draft', label: 'Borrador' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Alta' }]} />
          </div>
          <Button size="sm" disabled={busy || !printer || !Number.isInteger(Number(copies)) || Number(copies) < 1 || Number(copies) > 99} onClick={() => void action('print')}>Revisar envío a impresión</Button>
        </>}
      </div>}
    </section>
  );
}
