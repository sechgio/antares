import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, FolderOpen, Printer, Save } from 'lucide-react';
import { agentApi, type AgentArtifact } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ThemedSelect from '../ui/ThemedSelect';

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
    <section aria-label={`Documento ${file.name}`} className="w-full max-w-2xl space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
      <div className="flex min-w-0 items-center gap-2 text-sm text-[var(--text-primary)]">
        <FileText size={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
        <span className="shrink-0 text-xs text-[var(--text-secondary)]">{file.pages} pág.</span>
      </div>
      {artifact.files.length > 1 && <ThemedSelect value={String(fileIndex)} aria-label="Archivo del resultado"
        options={artifact.files.map((item, index) => ({ value: String(index), label: item.name }))}
        onChange={(value) => { setFileIndex(Number(value)); setPage(0); setPreview(''); setReviewed(''); }} />}
      <p className="text-xs text-[var(--text-secondary)]">{isReviewed ? 'PDF revisado' : 'Pendiente de revisión'} · {Math.ceil(file.size / 1024)} KB</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void action('preview')}>Vista previa</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action('open')}><FolderOpen size={13} className="mr-1" />Abrir PDF</Button>
        {onOpenModule && <Button size="sm" variant="ghost" onClick={() => onOpenModule(module, id)}>Abrir módulo</Button>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action('save')}><Save size={13} className="mr-1" />Guardar</Button>
        <Button size="sm" variant="ghost" disabled={busy || !isReviewed} onClick={() => void selectPrint()}><Printer size={13} className="mr-1" />Imprimir</Button>
      </div>
      {preview && <div className="space-y-2">
        <img src={`data:image/png;base64,${preview}`} alt={`Página ${page + 1} de ${file.name}`} className="max-h-[65vh] w-full object-contain" />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" disabled={busy || page === 0} aria-label="Página anterior" onClick={() => void action('preview', page - 1)}><ChevronLeft size={14} /></Button>
          <span className="text-xs text-[var(--text-secondary)]">{page + 1} / {file.pages}</span>
          <Button size="sm" variant="ghost" disabled={busy || page + 1 >= file.pages} aria-label="Página siguiente" onClick={() => void action('preview', page + 1)}><ChevronRight size={14} /></Button>
          <Button size="sm" disabled={busy || isReviewed} onClick={() => void action('review')}>He revisado este PDF</Button>
        </div>
      </div>}
      {showPrint && <div className="space-y-2 border-t border-[var(--border-subtle)] pt-2">
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
