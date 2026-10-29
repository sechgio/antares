import { useEffect, useId, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import { agentApi, type AgentImageArtifact } from '../../api/agentApi';
import { useToast } from '../../hooks/useToast';
import { errorMessage } from '../../utils/errors';
import Button from '../ui/Button';
import { DialogSurface } from '../ui/Dialog';

function ImagePreview({ sessionId, artifactId, fileIndex, file, fullSize = false, zoom = false }: {
  sessionId: string; artifactId: string; fileIndex: number; file: AgentImageArtifact['files'][number]; fullSize?: boolean; zoom?: boolean;
}) {
  const [preview, setPreview] = useState<{ status: 'loading' } | { status: 'ready'; src: string } | { status: 'error'; message: string }>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPreview({ status: 'loading' });
    void agentApi.agentArtifactAction({ session_id: sessionId, artifact_id: artifactId, file_index: fileIndex,
      sha256: file.sha256, action: 'preview', full_size: fullSize }).then((result) => {
      if (cancelled) return;
      if (!result.png_base64 || result.sha256 !== file.sha256) throw new Error('La imagen recibida no coincide con el resultado');
      setPreview({ status: 'ready', src: `data:image/png;base64,${result.png_base64}` });
    }).catch((err: unknown) => {
      if (!cancelled) setPreview({ status: 'error', message: errorMessage(err, 'No se pudo cargar la imagen') });
    });
    return () => { cancelled = true; };
  }, [sessionId, artifactId, fileIndex, file.sha256, fullSize, retry]);

  if (preview.status === 'loading') return <span role="status" className="block p-4 text-xs text-[var(--text-muted)]">Cargando imagen…</span>;
  if (preview.status === 'error') return <span className="block p-4 text-xs text-[var(--text-muted)]">
    <span role="alert">{preview.message}</span>
    {fullSize && <Button size="sm" variant="ghost" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}
  </span>;
  return <img src={preview.src} alt={file.title} draggable={false}
    onError={() => setPreview({ status: 'error', message: 'No se pudo mostrar la imagen' })}
    className={fullSize ? zoom ? 'w-[200%] max-w-none' : 'max-h-[72vh] w-full object-contain' : 'h-36 w-full object-contain'} />;
}

export default function ImageGallery({ artifact, sessionId, onRefresh }: { artifact: AgentImageArtifact; sessionId: string; onRefresh: () => void }) {
  const { addToast } = useToast();
  const titleId = useId();
  const [selected, setSelected] = useState<number | null>(null);
  const [zoom, setZoom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveRequest, setSaveRequest] = useState<{ index: number; id: string } | null>(null);
  const file = selected === null ? null : artifact.files[selected];
  const open = (index: number) => { setSelected(index); setZoom(false); };

  const save = async (index: number) => {
    if (saving) return;
    const item = artifact.files[index];
    if (!item) return;
    const request = saveRequest?.index === index ? saveRequest : { index, id: crypto.randomUUID() };
    setSaving(true);
    setSaveRequest(request);
    try {
      const result = await agentApi.agentArtifactAction({ session_id: sessionId, artifact_id: artifact.id,
        file_index: index, sha256: item.sha256, action: 'save', request_id: request.id });
      setSaveRequest(null);
      if (result.approval) addToast({ message: 'Revisa el guardado y apruébalo en el chat', type: 'info' });
      onRefresh();
    } catch (err) { addToast({ message: errorMessage(err, 'No se pudo guardar la imagen'), type: 'error' }); }
    finally { setSaving(false); }
  };

  return <section aria-label="Imágenes generadas" className="py-1">
    <div className={`grid gap-2 ${artifact.files.length === 1 ? 'grid-cols-1' : artifact.files.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
      {artifact.files.map((item, index) => <figure key={item.sha256 + index} className="min-w-0">
        <button type="button" aria-label={`Ampliar ${item.title}`} onClick={() => open(index)}
          className="flex h-40 w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 hover:border-[var(--accent-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]">
          <ImagePreview sessionId={sessionId} artifactId={artifact.id} fileIndex={index} file={item} />
        </button>
        <figcaption className="flex min-w-0 items-center gap-1 pt-1 text-xs text-[var(--text-muted)]">
          <span className="min-w-0 flex-1 truncate" title={item.title}>{item.title}</span>
          <Button size="none" variant="ghost" className="size-7 shrink-0" aria-label={`Descargar ${item.title}`}
            disabled={saving} onClick={() => void save(index)}><Download size={13} aria-hidden="true" /></Button>
        </figcaption>
      </figure>)}
    </div>
    {selected !== null && file && <DialogSurface portal labelledBy={titleId} onClose={() => setSelected(null)} className="max-w-6xl p-3">
      <div onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' && selected > 0) { event.preventDefault(); open(selected - 1); }
        if (event.key === 'ArrowRight' && selected + 1 < artifact.files.length) { event.preventDefault(); open(selected + 1); }
      }}>
        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">{file.title}</h2>
          <span className="text-xs text-[var(--text-muted)]">{selected + 1} / {artifact.files.length}</span>
          <Button size="sm" variant="ghost" aria-label="Imagen anterior" disabled={selected === 0} onClick={() => open(selected - 1)}><ChevronLeft size={16} /></Button>
          <Button size="sm" variant="ghost" aria-label="Imagen siguiente" disabled={selected + 1 === artifact.files.length} onClick={() => open(selected + 1)}><ChevronRight size={16} /></Button>
          <Button size="sm" variant="ghost" aria-label={zoom ? 'Ajustar imagen' : 'Ampliar imagen'} aria-pressed={zoom} onClick={() => setZoom((value) => !value)}>
            {zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
          </Button>
          <Button size="sm" variant="ghost" aria-label="Descargar imagen" disabled={saving} onClick={() => void save(selected)}><Download size={16} /></Button>
          <Button size="sm" variant="ghost" aria-label="Cerrar imagen" onClick={() => setSelected(null)}><X size={16} /></Button>
        </div>
        <div className="max-h-[75vh] overflow-auto rounded-lg bg-[var(--bg-elevated)]">
          <ImagePreview key={`${sessionId}:${artifact.id}:${selected}:${file.sha256}`} sessionId={sessionId}
            artifactId={artifact.id} fileIndex={selected} file={file} fullSize zoom={zoom} />
        </div>
      </div>
    </DialogSurface>}
  </section>;
}
