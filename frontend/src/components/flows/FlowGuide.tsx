import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { flowsApi, type GuidedPdfInput, type ReportBatchPreview } from '../../api/flowsApi';
import { toolsApi } from '../../api/toolsApi';
import { canvasApi } from '../../api/canvasApi';
import { formatosApi } from '../../api/formatosApi';
import { systemApi } from '../../api/systemApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ThemedSelect from '../ui/ThemedSelect';
import type { FlowNode } from './types';

const PdfPagePreview = lazy(() => import('../sellador/PdfPagePreview'));
const STEPS = ['Entradas', 'Plantilla', 'Personalizar', 'Salida', 'Vista previa'];

interface Props {
  node: FlowNode;
  trigger?: FlowNode;
  onChange: (node: FlowNode) => void;
}

export default function FlowGuide({ node, trigger, onChange }: Props) {
  const { addToast } = useToast();
  const input = node.config.args as unknown as GuidedPdfInput;
  const snapshot = JSON.stringify(input);
  const currentSnapshot = useRef(snapshot);
  currentSnapshot.current = snapshot;
  const requestId = useRef(0);
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<{ value: string; label: string }[]>([]);
  const [batch, setBatch] = useState<ReportBatchPreview | null>(null);
  const [reviewed, setReviewed] = useState('');
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState(0);
  const [page, setPage] = useState(1);
  const stale = reviewed !== snapshot;
  const mappings = input.field_mappings ?? {};
  const values = input.field_values ?? {};
  const patch = (changes: Partial<GuidedPdfInput>) => onChange({ ...node, config: { ...node.config, args: { ...input, ...changes } } });

  useEffect(() => {
    let alive = true;
    setTemplates([]);
    const request = input.template_kind === 'canvas'
      ? canvasApi.canvasList().then((r) => r.documents.map((d) => ({ value: d.id, label: d.name || 'Sin título' })))
      : input.template_kind === 'formato'
        ? formatosApi.formatosList().then((r) => r.formats.map((f) => ({ value: f.id, label: f.nombre })))
        : toolsApi.templatesList({ recursive: true }).then((r) => r.templates.map((t) => ({ value: t.name, label: t.name })));
    request.then((items) => { if (alive) setTemplates(items); }).catch((err) => {
      if (alive) addToast({ message: errorMessage(err, 'No se pudieron cargar las plantillas'), type: 'error' });
    });
    return () => { alive = false; };
  }, [input.template_kind, addToast]);

  useEffect(() => () => { requestId.current += 1; }, []);

  const choose = async (key: 'source_folder' | 'output_folder' | 'spreadsheet_path') => {
    try {
      const result = key === 'spreadsheet_path' ? await systemApi.dialogFiles()
        : await systemApi.dialogFolder({ pickOnly: true, title: key === 'source_folder' ? 'Carpeta de fotos' : 'Carpeta de salida' });
      const path = 'folder' in result ? result.folder : result.paths[0];
      if (path) patch({ [key]: path, ...(key === 'spreadsheet_path' ? { records_source: '', field_mappings: {}, row_values: {}, photo_selections: {} } : {}) });
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo seleccionar el archivo o carpeta'), type: 'error' });
    }
  };

  const review = async (pdf: boolean, previewIndex = record) => {
    const id = ++requestId.current;
    setBusy(true);
    try {
      const params = { ...input, _flow_file_grants: node.config._file_grants as Record<string, unknown> | undefined };
      const response = pdf ? await flowsApi.flowsPdfPreview({ ...params, preview_index: previewIndex }) : await flowsApi.flowsReadImages(params);
      if (id !== requestId.current || snapshot !== currentSnapshot.current) return;
      setBatch(response);
      setReviewed(snapshot);
      setPage(1);
      if (previewIndex >= (response.preview?.length ?? 0)) setRecord(0);
    } catch (err) {
      if (id === requestId.current) addToast({ message: errorMessage(err, 'No se pudo revisar el lote'), type: 'error' });
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };

  const canReview = !!input.output_folder && !!input.template_id;
  const fields = Object.keys(batch?.suggested_mappings ?? {});
  const imageLimit = batch?.image_limit ?? 0;
  const selectedRow = batch?.preview?.[record];
  const rowKey = selectedRow?.record_key ?? String(record);
  const selectedPhotos = input.photo_selections?.[rowKey] ?? selectedRow?.images ?? [];
  const setPhotos = (photos: string[]) => patch({ photo_selections: { ...input.photo_selections, [rowKey]: photos } });

  return (
    <section aria-label="Guía de PDF personalizado" className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="Pasos de la guía" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-medium)] px-5 py-3">
        {STEPS.map((label, index) => <Button key={label} variant={step === index ? 'primary' : 'ghost'} size="sm" aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}>{index + 1}. {label}</Button>)}
      </nav>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto max-w-5xl space-y-5">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{STEPS[step]}</h2>
          {step === 0 && <div className="max-w-xl space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">Conecta los datos y las carpetas que utilizará este flujo. También puedes usar valores fijos para un único documento.</p>
            <label className="block space-y-1 text-sm">Datos de origen
              <ThemedSelect aria-label="Datos de origen" value={input.records_source || (input.spreadsheet_path ? 'excel' : 'manual')}
                options={[{ value: 'manual', label: 'Valores fijos' }, { value: 'excel', label: 'Excel o CSV' }, { value: 'technical_reports', label: 'Informes técnicos guardados' }, { value: 'informes_v2', label: 'Informes v2 guardados' }, { value: 'fichas_tecnicas', label: 'Fichas técnicas guardadas' }]}
                onChange={(value) => {
                  if (value === 'excel') { void choose('spreadsheet_path'); return; }
                  patch({ records_source: ['manual', 'excel'].includes(value) ? '' : value, spreadsheet_path: '', field_mappings: {}, row_values: {}, photo_selections: {} });
                  setBatch(null); setRecord(0);
                }} />
            </label>
            {(['spreadsheet_path', 'source_folder', 'output_folder'] as const).map((key) => <div key={key} className="space-y-1">
              <label htmlFor={`guide-${key}`} className="text-sm">{key === 'spreadsheet_path' ? 'Excel o CSV (opcional)' : key === 'source_folder' ? 'Carpeta de fotos y subcarpetas (opcional)' : 'Carpeta de salida'}</label>
              <div className="flex gap-2"><Input id={`guide-${key}`} readOnly value={input[key] ?? ''} className="min-w-0 flex-1" placeholder="Selecciona con el botón…" />
                <Button variant="secondary" size="sm" onClick={() => void choose(key)}>Elegir {key === 'spreadsheet_path' ? 'Excel' : key === 'source_folder' ? 'fotos' : 'salida'}</Button>
                {key !== 'output_folder' && input[key] && <Button variant="ghost" size="sm" aria-label={`Quitar ${key === 'source_folder' ? 'carpeta de fotos' : 'Excel'}`} onClick={() => patch({ [key]: '' })}>Quitar</Button>}
              </div>
            </div>)}
            {input.records_source && <p className="text-xs text-[var(--text-secondary)]">Se consultan los registros guardados de la herramienta. Para crear o actualizar registros, añade acciones explícitas desde el editor de nodos.</p>}
          </div>}
          {step === 1 && <div className="max-w-xl space-y-4">
            <label className="block space-y-1 text-sm">Tipo de plantilla
              <ThemedSelect aria-label="Tipo de plantilla" value={input.template_kind} options={[{ value: 'html', label: 'Plantillas de Antares (HTML)' }, { value: 'canvas', label: 'Documentos de Canvas' }, { value: 'formato', label: 'Formatos PDF numerados' }]}
                onChange={(value) => { patch({ template_kind: value as GuidedPdfInput['template_kind'], template_id: '', field_mappings: {}, field_values: {}, row_values: {}, photo_selections: {}, images_per_panel: undefined, required_fields: [] }); setBatch(null); setRecord(0); }} />
            </label>
            <label className="block space-y-1 text-sm">Plantilla
              <ThemedSelect aria-label="Plantilla del PDF" value={input.template_id} options={[{ value: '', label: 'Selecciona una plantilla…' }, ...templates]}
                onChange={(value) => { patch({ template_id: value, row_values: {}, photo_selections: {}, images_per_panel: undefined }); setBatch(null); setRecord(0); }} />
            </label>
            {input.template_kind === 'canvas' && <p className="text-xs text-[var(--text-secondary)]">El diseño se prepara en Canvas. Este flujo utiliza su exportador PDF CMYK y muestra el resultado de ese mismo motor.</p>}
            <Button variant="secondary" disabled={!canReview || busy} onClick={() => { setStep(2); void review(false); }}>Leer campos y datos</Button>
          </div>}
          {step === 2 && <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={!canReview || busy} onClick={() => void review(false)}>{busy ? 'Leyendo…' : 'Revisar datos y fotos'}</Button>
              {batch?.reason && <p role="status" className="text-sm text-[var(--text-secondary)]">{stale ? 'Hay cambios pendientes de revisar.' : batch.reason}</p>}
            </div>
            {input.template_kind === 'formato' ? <div className="grid max-w-xl grid-cols-2 gap-4">
              {(['number_from', 'number_to'] as const).map((key) => <label key={key} className="space-y-1 text-sm">{key === 'number_from' ? 'Número inicial' : 'Número final'}<Input aria-label={key === 'number_from' ? 'Número inicial' : 'Número final'} type="number" min={0} value={input[key] ?? 1} onChange={(e) => patch({ [key]: Math.max(0, Math.round(Number(e.target.value))) })} /></label>)}
            </div> : <>
              {!!batch?.headers?.length && <div className="grid max-w-xl grid-cols-2 gap-4">
                <label className="space-y-1 text-sm">Clave para asociar fotos<ThemedSelect aria-label="Clave para asociar fotos" value={input.match_key || batch.match_key || ''} options={[{ value: '', label: 'Detectar clave' }, ...batch.headers.map((h) => ({ value: h, label: h }))]} onChange={(value) => patch({ match_key: value, photo_selections: {}, row_values: {} })} /></label>
                <label className="space-y-1 text-sm">Fecha para distinguir registros<ThemedSelect aria-label="Fecha para distinguir registros" value={input.match_date ?? ''} options={[{ value: '', label: 'Sin fecha' }, ...batch.headers.map((h) => ({ value: h, label: h }))]} onChange={(value) => patch({ match_date: value, photo_selections: {}, row_values: {} })} /></label>
              </div>}
              {imageLimit > 0 && <label className="block max-w-xs space-y-1 text-sm">Fotos obligatorias por registro<Input aria-label="Fotos obligatorias por registro" type="number" min={0} max={imageLimit} value={input.images_per_panel ?? 1} onChange={(e) => patch({ images_per_panel: Math.max(0, Math.min(imageLimit, Math.round(Number(e.target.value)))) })} /></label>}
              {fields.length > 0 && <div className="space-y-3">
                <div className="flex items-center gap-3"><h3 className="text-sm font-semibold">Campos de la plantilla</h3><Button variant="ghost" size="sm" onClick={() => patch({ field_mappings: { ...batch?.suggested_mappings, ...mappings } })}>Autocompletar columnas</Button></div>
                {fields.filter((field) => !['productos', 'personal_tecnico'].includes(field)).map((field) => <div key={field} className="grid items-center gap-2 border-b border-[var(--border-subtle)] pb-3 sm:grid-cols-[minmax(140px,1fr)_1fr_1fr]">
                  <label className="text-sm" htmlFor={`guide-field-${field}`}>{batch?.field_labels?.[field] ?? field}{batch?.required_fields?.includes(field) && ' *'}</label>
                  <ThemedSelect aria-label={`Columna para ${field}`} value={mappings[field] ?? ''} options={[{ value: '', label: 'Sin columna' }, ...(batch?.headers ?? []).map((h) => ({ value: h, label: h }))]} onChange={(value) => {
                    const nextValues = { ...values }; delete nextValues[field];
                    patch({ field_mappings: { ...mappings, [field]: value }, field_values: nextValues });
                  }} />
                  <Input id={`guide-field-${field}`} aria-label={`Valor fijo de ${field}`} placeholder="Valor fijo (opcional)" value={values[field] ?? ''} onChange={(e) => {
                    const nextValues = { ...values }; if (e.target.value) nextValues[field] = e.target.value; else delete nextValues[field];
                    patch({ field_values: nextValues });
                  }} />
                </div>)}
              </div>}
              {fields.some((field) => ['productos', 'personal_tecnico'].includes(field)) && <p className="text-xs text-[var(--text-secondary)]">Las listas de productos y personal se toman de las fichas guardadas. Puedes prepararlas en Fichas Técnicas y seleccionar esa fuente en Entradas.</p>}
            </>}
            {batch?.preview && <>
              <ThemedSelect aria-label="Registro para revisar" value={String(record)} options={batch.preview.map((row, i) => ({ value: String(i), label: `Registro ${i + 1}${row.ot ? ` · ${row.ot}` : ''}` }))} onChange={(value) => { setRecord(Number(value)); setPage(1); }} />
              {selectedRow && <div className="grid gap-5 lg:grid-cols-2">
                <details className="space-y-3" open><summary className="cursor-pointer text-sm font-semibold">Datos del registro</summary>
                  {Object.entries(selectedRow.data).filter(([field]) => fields.includes(field) && !['productos', 'personal_tecnico'].includes(field)).map(([field, value]) => <label key={field} className="block space-y-1 text-xs">{batch.field_labels?.[field] ?? field}<Input aria-label={`Registro ${record + 1}: ${field}`} value={input.row_values?.[rowKey]?.[field] ?? value} onChange={(e) => patch({ row_values: { ...input.row_values, [rowKey]: { ...input.row_values?.[rowKey], [field]: e.target.value } } })} /></label>)}
                </details>
                {imageLimit > 0 && <details className="space-y-2" open><summary className="cursor-pointer text-sm font-semibold">Fotos y orden</summary>
                  {selectedPhotos.map((name, i) => <div key={name} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 break-all">{i + 1}. {name}</span>
                    <Button variant="ghost" size="sm" aria-label={`Subir foto ${name}`} disabled={i === 0} onClick={() => { const next = [...selectedPhotos]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; setPhotos(next); }}>Subir</Button>
                    <Button variant="ghost" size="sm" aria-label={`Bajar foto ${name}`} disabled={i === selectedPhotos.length - 1} onClick={() => { const next = [...selectedPhotos]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; setPhotos(next); }}>Bajar</Button>
                  </div>)}
                  <div className="max-h-64 space-y-2 overflow-auto">{selectedRow.candidates.map((name) => <label key={name} className="flex items-start gap-2 text-xs"><Input type="checkbox" className="h-4 w-4 shrink-0" aria-label={`Asignar foto ${name}`} checked={selectedPhotos.includes(name)} disabled={!selectedPhotos.includes(name) && selectedPhotos.length >= imageLimit} onChange={(e) => setPhotos(e.target.checked ? [...selectedPhotos, name] : selectedPhotos.filter((photo) => photo !== name))} /><span className="break-all">{name}</span></label>)}</div>
                </details>}
              </div>}
              {!!selectedRow?.errors.length && <ul role="alert" className="space-y-1 text-xs text-[var(--accent-red)]">{selectedRow.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
            </>}
          </div>}
          {step === 3 && <div className="max-w-xl space-y-4">
            <label className="block space-y-1 text-sm">Organización de los PDFs<ThemedSelect aria-label="Organización de los PDFs" value={input.output_mode ?? 'consolidado'} options={[{ value: 'consolidado', label: 'Un PDF consolidado con todo el lote' }, { value: 'individual', label: 'Un PDF por registro' }]} onChange={(value) => patch({ output_mode: value as GuidedPdfInput['output_mode'] })} /></label>
            <label className="block space-y-1 text-sm">Nombre del PDF<Input className="block w-full" aria-label="Nombre del PDF" value={input.filename_pattern ?? 'Documento.pdf'} placeholder="Informe_{OT}_{FECHA_TRABAJO}.pdf" onChange={(e) => patch({ filename_pattern: e.target.value })} /></label>
            <p className="text-xs text-[var(--text-secondary)]">Utiliza campos entre llaves, como {'{OT}'}, {'{NIS}'} o {'{NUMERO}'}. En el consolidado se usan los datos del primer registro. Cada entrega incorpora una versión del contenido para conservar los archivos anteriores.</p>
            {trigger && <>
              <label className="flex items-center gap-2 text-sm"><Input type="checkbox" className="h-4 w-4" checked={trigger.config.trigger_kind === 'schedule'} onChange={(e) => onChange({ ...trigger, config: { ...trigger.config, trigger_kind: e.target.checked ? 'schedule' : 'manual', runtime: 'app_open', interval_minutes: trigger.config.interval_minutes ?? 1 } })} />Revisar carpetas automáticamente con Antares abierto</label>
              {trigger.config.trigger_kind === 'schedule' && <label className="block space-y-1 text-sm">Revisar cada (minutos)<Input aria-label="Intervalo de revisión" type="number" min={1} max={10080} value={Number(trigger.config.interval_minutes ?? 1)} onChange={(e) => onChange({ ...trigger, config: { ...trigger.config, interval_minutes: Math.max(1, Math.min(10080, Math.round(Number(e.target.value)))) } })} /></label>}
              <p className="text-xs text-[var(--text-secondary)]">Guarda el flujo y activa «Activo» para automatizarlo. Puedes ejecutarlo manualmente en cualquier momento. Esperará todos los datos y fotos obligatorios antes de generar.</p>
            </>}
          </div>}
          {step === 4 && <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3"><Button variant="primary" disabled={!canReview || busy} onClick={() => void review(true)}>{busy ? 'Preparando…' : 'Revisar PDF'}</Button>
              {batch?.preview && <ThemedSelect aria-label="Registro de la vista previa" value={String(record)} options={batch.preview.map((row, i) => ({ value: String(i), label: `Registro ${i + 1}${row.ot ? ` · ${row.ot}` : ''}` }))} onChange={(value) => { const index = Number(value); setRecord(index); void review(true, index); }} />}
            </div>
            <p role="status" className="text-sm text-[var(--text-secondary)]">{stale ? 'Revisa el PDF para comprobar la configuración actual.' : batch?.reason ?? 'La vista previa valida el lote completo y muestra el registro seleccionado.'}</p>
            {!stale && !!batch?.pending?.length && <ul role="alert" className="space-y-1 text-xs text-[var(--accent-red)]">{batch.pending.map((error, i) => <li key={`${i}:${error}`}>{error}</li>)}</ul>}
            {!stale && batch?.ready && <div className="space-y-2"><p className="text-sm">{batch.preview?.length} registros completos · {batch.output_names?.length} PDF de salida</p><ul className="max-h-32 overflow-auto text-xs text-[var(--text-secondary)]">{batch.output_names?.map((name) => <li key={name}>{name}</li>)}</ul></div>}
            {!stale && batch?.pdf_base64 && <>
              <div className="flex items-center gap-3"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Página anterior</Button><span className="text-xs">Página {page} de {batch.preview_pages ?? 1}</span><Button variant="secondary" size="sm" disabled={page >= (batch.preview_pages ?? 1)} onClick={() => setPage(page + 1)}>Página siguiente</Button></div>
              <Suspense fallback={<p className="text-sm text-[var(--text-secondary)]">Cargando vista previa…</p>}><PdfPagePreview pdfBase64={batch.pdf_base64} pageNum={page} width={800} /></Suspense>
            </>}
          </div>}
          <div className="flex justify-between border-t border-[var(--border-medium)] pt-4"><Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Anterior</Button><Button variant="secondary" disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>Siguiente</Button></div>
        </div>
      </div>
    </section>
  );
}
