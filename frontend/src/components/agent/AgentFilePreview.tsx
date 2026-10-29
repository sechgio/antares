import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { agentApi, type AgentFilePreview as FilePreviewData, type AgentFilePreviewTarget } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import Button from '../ui/Button';
import ThemedSelect from '../ui/ThemedSelect';

function columnName(index: number): string {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}

function PreviewContent({ data, zoom }: { data: FilePreviewData; zoom: number }) {
  if (data.kind === 'pdf' || data.kind === 'image') {
    return <img src={`data:image/png;base64,${data.png_base64}`} alt={data.kind === 'pdf' ? `Página ${data.page + 1} de ${data.name}` : data.name}
      className="mx-auto block h-auto max-w-none" style={{ width: `${zoom}%` }} />;
  }
  if (data.kind === 'spreadsheet') {
    return <table className="w-full border-collapse text-left text-xs text-[var(--text-primary)]">
      <thead className="sticky top-0 bg-[var(--bg-elevated)]"><tr><th scope="col" className="border border-[var(--border-subtle)] p-2">Fila</th>
        {Array.from({ length: Math.min(data.total_columns, 50) }, (_, index) => <th key={index} scope="col" className="min-w-24 border border-[var(--border-subtle)] p-2">{columnName(index)}</th>)}
      </tr></thead>
      <tbody>{data.rows.map((row, index) => <tr key={index}>
        <th scope="row" className="border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[var(--text-muted)]">{data.row_start + index}</th>
        {Array.from({ length: Math.min(data.total_columns, 50) }, (_, col) => <td key={col} className="max-w-80 whitespace-pre-wrap break-words border border-[var(--border-subtle)] px-2 py-1">{row[col] ?? ''}</td>)}
      </tr>)}</tbody>
    </table>;
  }
  if (data.kind === 'document') {
    return <article aria-label="Contenido de Word" className="mx-auto max-w-3xl space-y-3 bg-[var(--bg-surface)] p-6 text-sm leading-relaxed text-[var(--text-primary)]">
      {data.blocks.map((block, index) => block.kind === 'table'
        ? <table key={index} className="w-full border-collapse text-left"><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} className="whitespace-pre-wrap border border-[var(--border-medium)] p-2 align-top">{cell}</td>)}</tr>)}</tbody></table>
        : block.style === 'h1' ? <h1 key={index} className="text-2xl font-semibold">{block.text}</h1>
          : block.style === 'h2' ? <h2 key={index} className="text-xl font-semibold">{block.text}</h2>
            : block.style === 'h3' ? <h3 key={index} className="text-lg font-semibold">{block.text}</h3>
              : <p key={index} className="whitespace-pre-wrap">{block.text || '\u00a0'}</p>)}
    </article>;
  }
  return <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-[var(--text-primary)]">{data.text}</pre>;
}

type PreviewState = { kind: 'loading' } | { kind: 'ready'; data: FilePreviewData } | { kind: 'error'; message: string };

export default function AgentFilePreview({ sessionId, target, onClose }: {
  sessionId: string; target: AgentFilePreviewTarget; onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [sheet, setSheet] = useState(0);
  const [reload, setReload] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  const closeRef = useRef<HTMLButtonElement>(null);
  const name = target.kind === 'attachment' ? target.name : target.resource.split(/[\\/]/).pop() || target.resource;
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    void agentApi.agentFilePreview(sessionId, target, page, sheet).then((data) => {
      if (active) setState({ kind: 'ready', data });
    }).catch((err: unknown) => {
      if (active) setState({ kind: 'error', message: errorMessage(err, 'No se pudo previsualizar el archivo') });
    });
    return () => { active = false; };
  }, [sessionId, target, page, sheet, reload]);
  const data = state.kind === 'ready' ? state.data : null;
  const pages = data && (data.kind === 'pdf' || data.kind === 'spreadsheet') ? data.pages : 0;
  const raster = data?.kind === 'pdf' || data?.kind === 'image';
  return <aside aria-label="Vista previa de archivo" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
    className="absolute inset-0 z-30 flex min-h-0 flex-col overflow-hidden rounded-l-lg border border-[var(--border-medium)] bg-[var(--bg-base)] md:static md:w-1/2 md:min-w-[320px] md:max-w-[760px] md:shrink-0">
    <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] p-2">
      <FileText size={16} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
      <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-medium text-[var(--text-primary)]" title={name}>{data?.name || name}</h2>
        <p className="text-[11px] text-[var(--text-muted)]">Vista previa{data ? ` · ${Math.ceil(data.size / 1024)} KB` : ''}</p></div>
      <Button variant="ghost" size="none" className="size-8" aria-label="Recargar vista previa" onClick={() => setReload((value) => value + 1)}><RotateCw size={14} /></Button>
      <Button ref={closeRef} variant="ghost" size="none" className="size-8" aria-label="Cerrar vista previa" onClick={onClose}><X size={16} /></Button>
    </header>
    {data?.kind === 'spreadsheet' && <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] p-2">
      <ThemedSelect aria-label="Hoja de cálculo" value={String(sheet)} options={data.sheets.map((label, index) => ({ value: String(index), label }))}
        onChange={(value) => { setSheet(Number(value)); setPage(0); }} />
      <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{data.total_rows} filas · {data.total_columns} columnas</span>
    </div>}
    <div className="custom-scrollbar min-h-0 flex-1 overflow-auto" aria-busy={state.kind === 'loading'}>
      {state.kind === 'loading' ? <p role="status" className="p-6 text-sm text-[var(--text-muted)]">Cargando vista previa…</p>
        : state.kind === 'error' ? <div role="alert" className="space-y-3 p-6 text-sm text-[var(--text-secondary)]"><p>{state.message}</p>
          <Button size="sm" variant="secondary" onClick={() => setReload((value) => value + 1)}>Reintentar</Button></div>
          : <PreviewContent data={state.data} zoom={zoom} />}
    </div>
    {data && <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] p-2 text-xs text-[var(--text-secondary)]">
      {pages > 0 && <>
        <Button variant="ghost" size="none" className="size-8" aria-label="Página anterior" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></Button>
        <span aria-live="polite">{page + 1} / {pages}</span>
        <Button variant="ghost" size="none" className="size-8" aria-label="Página siguiente" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></Button>
      </>}
      {raster && <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="none" className="size-8" aria-label="Alejar" disabled={zoom <= 50} onClick={() => setZoom((value) => value - 25)}><ZoomOut size={14} /></Button>
        <Button variant="ghost" size="sm" onClick={() => setZoom(100)} aria-label="Ajustar al ancho">{zoom}%</Button>
        <Button variant="ghost" size="none" className="size-8" aria-label="Acercar" disabled={zoom >= 200} onClick={() => setZoom((value) => value + 25)}><ZoomIn size={14} /></Button>
      </div>}
      {data.kind === 'document' && <span>Vista de contenido de Word · La distribución puede variar.</span>}
      {data.kind === 'spreadsheet' && <span>Valores guardados · Las fórmulas no se recalculan.</span>}
      {'truncated' in data && data.truncated && <span role="status">Se muestra una parte del contenido por su tamaño.</span>}
    </footer>}
  </aside>;
}
