import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, FolderOpen, Trash2, X } from 'lucide-react';
import { flowsApi, type ReportBatchPreview } from '../../api/flowsApi';
import { connectionsApi } from '../../api/connectionsApi';
import { systemApi } from '../../api/systemApi';
import { canvasApi } from '../../api/canvasApi';
import { formatosApi } from '../../api/formatosApi';
import { toolsApi } from '../../api/toolsApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import ThemedSelect from '../ui/ThemedSelect';
import {
  AgentConfigEditor,
  FieldLabel,
  McpCallConfigEditor,
  RetryConfigEditor,
  SwitchConfigEditor,
  ObjectFieldsEditor,
  type DataSource,
} from './NodeConfigBlocks';
import {
  CONDITION_OPS,
  ENABLED_TRIGGER_KINDS,
  NODE_KIND_DEFS,
  TRIGGER_KIND_LABELS,
  METHOD_LABELS,
  METHOD_FIELDS,
} from './nodeDefs';
import type { FlowNode, TriggerKind } from './types';

interface Props {
  node: FlowNode | null;
  onChange: (node: FlowNode) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
  onDraftChange?: () => void;
  sources?: DataSource[];
}

export default function NodeConfigDrawer({ node, onChange, onDelete, onClose, onDraftChange, sources = [] }: Props) {
  const { addToast } = useToast();
  const [methods, setMethods] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [templates, setTemplates] = useState<{ value: string; label: string }[]>([]);
  const [printers, setPrinters] = useState<{ name: string; default: boolean }[]>([]);
  const [connections, setConnections] = useState<{ id: string; label: string; connected: boolean }[]>([]);
  const [fieldError, setFieldError] = useState('');
  const [comparisonRevision, setComparisonRevision] = useState(0);
  const [batchPreview, setBatchPreview] = useState<ReportBatchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewArgs, setPreviewArgs] = useState('');
  const [appEvents, setAppEvents] = useState<{ id: string; label: string }[]>([]);
  const [webhookInfo, setWebhookInfo] = useState<{ running: boolean; port: number; url_template: string } | null>(null);

  useEffect(() => {
    let alive = true;
    flowsApi
      .flowsOrchestratableMethods()
      .then((res) => {
        if (alive) { setMethods(res.methods); setActions(res.actions ?? []); }
      })
      .catch((err) => addToast({ message: errorMessage(err, 'No se pudieron cargar los métodos'), type: 'error' }));
    connectionsApi
      .connectionsProviders()
      .then((res) => {
        if (alive)
          setConnections(
            res.providers.map((p) => ({ id: p.id, label: p.label, connected: p.connected })),
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [addToast]);

  const method = String(node?.config.method ?? '');
  const templateBatch = Boolean((node?.config.args as Record<string, unknown> | undefined)?.report_template);
  useEffect(() => {
    let alive = true;
    setTemplates([]);
    const request = method === 'canvas_get' ? canvasApi.canvasList().then((res) => res.documents.map((d) => ({ value: d.id, label: d.name || 'Sin título' })))
      : method === 'formatos_generate' ? formatosApi.formatosList().then((res) => res.formats.map((f) => ({ value: f.id, label: f.nombre })))
      : method === 'flows_render_pdf' || method === 'template_get' || (method === 'flows_read_images' && templateBatch) ? toolsApi.templatesList({ recursive: true }).then((res) => res.templates.map((t) => ({ value: t.name, label: t.name }))) : null;
    request?.then((options) => { if (alive) setTemplates(options); }).catch((err) => {
      if (alive) addToast({ message: errorMessage(err, 'No se pudieron cargar las plantillas'), type: 'error' });
    });
    return () => { alive = false; };
  }, [method, templateBatch, addToast]);
  useEffect(() => {
    let alive = true;
    setPrinters([]);
    if (method === 'flows_print_pdf') flowsApi.flowsPrintersList().then((res) => {
      if (alive) setPrinters(res.printers);
    }).catch((err) => { if (alive) addToast({ message: errorMessage(err, 'No se pudieron cargar las impresoras'), type: 'error' }); });
    return () => { alive = false; };
  }, [method, addToast]);

  const triggerKind = node?.kind === 'trigger' ? String(node.config.trigger_kind ?? 'manual') : '';
  useEffect(() => {
    let alive = true;
    if (triggerKind === 'app_event') flowsApi.flowsEventsList().then((res) => {
      if (alive) setAppEvents(res.events);
    }).catch(() => {});
    if (triggerKind === 'webhook') flowsApi.flowsWebhookInfo().then((res) => {
      if (alive) setWebhookInfo(res);
    }).catch(() => {});
    return () => { alive = false; };
  }, [triggerKind]);

  if (!node) return null;
  const def = NODE_KIND_DEFS[node.kind];

  const patchConfig = (patch: Record<string, unknown>) =>
    onChange({ ...node, config: { ...node.config, ...patch } });

  const args = (node.config.args && typeof node.config.args === 'object' && !Array.isArray(node.config.args)
    ? node.config.args : {}) as Record<string, unknown>;
  const patchArgs = (patch: Record<string, unknown>) => patchConfig({ args: { ...args, ...patch } });
  const reportBatch = Boolean(args.report_template);
  const batchPanel = method === 'flows_read_images' && reportBatch;
  const imageLimit = batchPreview?.template_name === args.report_template ? batchPreview?.image_limit ?? 6 : 6;
  const mappings = (args.field_mappings ?? {}) as Record<string, string>;
  const selections = (args.photo_selections ?? {}) as Record<string, string[]>;
  const previewStale = previewArgs !== JSON.stringify(args);
  const previewBatch = async () => {
    setPreviewing(true);
    setBatchPreview(null);
    try {
      const result = await flowsApi.flowsReadImages({
        source_folder: String(args.source_folder ?? ''), output_folder: String(args.output_folder ?? ''),
        spreadsheet_path: String(args.spreadsheet_path ?? ''), report_template: String(args.report_template),
        images_per_panel: Number(args.images_per_panel ?? 6), field_mappings: mappings, photo_selections: selections,
      });
      setBatchPreview(result);
      setPreviewArgs(JSON.stringify(args));
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo preparar la vista previa'), type: 'error' });
    } finally {
      setPreviewing(false);
    }
  };
  const choosePath = async (key: string, folder: boolean, save = false) => {
    try {
      const result = folder ? await systemApi.dialogFolder({ pickOnly: true, title: key === 'source_folder' ? 'Carpeta de imágenes' : 'Carpeta de salida' })
        : save ? await systemApi.dialogSave({ title: 'Archivo de salida', filters: [{ name: 'PDF', extensions: ['pdf'] }] })
          : await systemApi.dialogFiles();
      const value = 'folder' in result ? result.folder : result.paths[0];
      if (value) patchArgs({ [key]: value });
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo seleccionar la ruta'), type: 'error' });
    }
  };

  const parseJsonField = (raw: string, apply: (value: unknown) => void, label: string) => {
    if (!raw.trim()) {
      apply(undefined);
      return;
    }
    try {
      apply(JSON.parse(raw));
    } catch {
      addToast({ message: `${label}: JSON inválido, no se aplicó el cambio`, type: 'error' });
    }
  };

  return (
    <aside className={`flex shrink-0 flex-col border-l border-[var(--border-medium)] bg-[var(--bg-base)] [&_[data-json]:invalid]:border-[var(--accent-red)] ${batchPanel ? 'w-96 max-w-full [&_label]:normal-case [&_label]:text-xs' : 'w-80'}`}
      onChangeCapture={(e) => {
        const field = e.target;
        if (!(field instanceof HTMLTextAreaElement)) return;
        onDraftChange?.();
        if (!field.hasAttribute('data-json')) return;
        let message = '';
        try {
          if (field.value.trim()) JSON.parse(field.value);
        } catch {
          message = 'Revisa las comillas y las llaves: este campo contiene JSON inválido.';
        }
        field.setCustomValidity(message);
        field.setAttribute('aria-invalid', String(!!message));
        setFieldError(e.currentTarget.querySelector<HTMLTextAreaElement>('textarea:invalid')?.validationMessage ?? '');
      }}>
      <div className="flex items-center justify-between border-b border-[var(--border-medium)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{
              background: `color-mix(in srgb, ${def.accent} 16%, transparent)`,
              color: def.accent,
            }}
          >
            <def.icon size={13} />
          </span>
          <div className="min-w-0">
            {batchPanel ? <Input aria-label="Nombre" value={node.name} onChange={(e) => onChange({ ...node, name: e.target.value })}
              className="w-full truncate !border-transparent !bg-transparent !p-0 text-sm font-semibold" placeholder="Lote de reportes" />
              : <div className="text-sm font-semibold text-[var(--text-primary)]">{def.label}</div>}
            <div className="text-[10px] text-[var(--text-secondary)]">{batchPanel ? 'Configuración del lote' : node.id}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {node.kind !== 'trigger' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(node.id)}
              aria-label="Eliminar nodo"
            >
              <Trash2 size={15} />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar">
            <X size={15} />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {fieldError && <p role="alert" className="text-xs text-[var(--accent-red)]">{fieldError}</p>}
        {!batchPanel && <div>
          <FieldLabel>Nombre</FieldLabel>
          <Input
            value={node.name}
            onChange={(e) => onChange({ ...node, name: e.target.value })}
            placeholder={node.id}
          />
        </div>}

        {node.kind === 'trigger' && (
          <div>
            <FieldLabel>Tipo de disparo</FieldLabel>
            <ThemedSelect
              value={String(node.config.trigger_kind ?? 'manual')}
              onChange={(v) => patchConfig({
                trigger_kind: v as TriggerKind,
                // Campos del disparo anterior que no aplican al nuevo tipo.
                event: undefined,
                path: undefined,
                interval_minutes: undefined,
                // El webhook exige clave: se autogenera al elegir el disparo.
                secret: v === 'webhook' ? crypto.randomUUID().replaceAll('-', '') : undefined,
              })}
              options={Object.entries(TRIGGER_KIND_LABELS).map(([value, label]) => ({
                value,
                label: ENABLED_TRIGGER_KINDS.includes(value as TriggerKind)
                  ? label
                  : `${label} (próximamente)`,
              }))}
            />
            {!ENABLED_TRIGGER_KINDS.includes((node.config.trigger_kind ?? 'manual') as TriggerKind) && (
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Este disparo aún no está disponible; el flujo se ejecutará manualmente.
              </p>
            )}
          </div>
        )}

        {node.kind === 'trigger' && node.config.trigger_kind === 'schedule' && (
          <div>
            <FieldLabel>Intervalo (minutos)</FieldLabel>
            <Input
              type="number"
              min={1}
              max={10080}
              value={Number(node.config.interval_minutes ?? 60)}
              onChange={(e) => {
                const value = Math.round(Number(e.target.value));
                if (Number.isFinite(value)) patchConfig({ interval_minutes: value });
              }}
            />
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Se ejecuta cada N minutos mientras la app esté abierta. Los flujos activos
              también se registran en el Programador de tareas de Windows y corren con
              la aplicación cerrada.
            </p>
          </div>
        )}

        {node.kind === 'trigger' && node.config.trigger_kind === 'app_event' && (
          <div>
            <FieldLabel>Evento de la app</FieldLabel>
            <ThemedSelect
              value={String(node.config.event ?? '')}
              options={[
                { value: '', label: 'Selecciona un evento…' },
                ...appEvents.map((e) => ({ value: e.id, label: e.label ? `${e.id} — ${e.label}` : e.id })),
                ...(node.config.event && !appEvents.some((e) => e.id === node.config.event)
                  ? [{ value: String(node.config.event), label: String(node.config.event) }]
                  : []),
              ]}
              onChange={(event) => patchConfig({ event })}
            />
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              El flujo se ejecuta cuando ocurre el evento dentro de Antares.
            </p>
          </div>
        )}

        {node.kind === 'trigger' && node.config.trigger_kind === 'webhook' && (
          <div className="space-y-3">
            <div>
              <FieldLabel>Sufijo del webhook (opcional)</FieldLabel>
              <Input
                value={String(node.config.path ?? '')}
                onChange={(e) => patchConfig({ path: e.target.value.replace(/^\/+/, '') || undefined })}
                placeholder="pago"
                spellCheck={false}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <FieldLabel>Secreto (obligatorio)</FieldLabel>
              <div className="flex gap-2">
                <Input
                  value={String(node.config.secret ?? '')}
                  onChange={(e) => patchConfig({ secret: e.target.value || undefined })}
                  placeholder="Clave compartida"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => patchConfig({ secret: crypto.randomUUID().replaceAll('-', '') })}
                >
                  Generar
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Obligatoria: se valida en la cabecera <code>X-Antares-Flow-Key</code> o el parámetro <code>?key=</code>.
              </p>
            </div>
            {webhookInfo?.running && (
              <p className="break-all font-mono text-[11px] text-[var(--text-secondary)]">
                Escuchando en {webhookInfo.url_template} (solo esta máquina)
              </p>
            )}
          </div>
        )}

        {node.kind === 'tool_call' && (
          <>
            <details open={!batchPanel}>
              <summary className={batchPanel ? 'cursor-pointer text-xs text-[var(--text-secondary)]' : 'hidden'}>Opciones del paso</summary>
              <div className={batchPanel ? 'mt-3 space-y-3' : ''}>
              <FieldLabel>¿Qué quieres hacer?</FieldLabel>
              <ThemedSelect
                value={String(node.config.method ?? '')}
                onChange={(v) => patchConfig({ method: v, required_args: v === 'flows_read_images' ? ['source_folder', 'output_folder'] : v === 'canvas_get' ? ['id'] : v === 'formatos_generate' ? ['format_id'] : v === 'flows_print_pdf' ? ['pdf_path', 'printer_name'] : [],
                  ...(actions.includes(v) ? { args: v === 'flows_read_images' ? { expected_images: 1, images_per_panel: 1 } : v === 'formatos_generate' ? { desde: 1, hasta: 1 } : v === 'sellador_apply' ? { stamp_count: 1 } : v === 'flows_print_pdf' ? { printer_name: '', copies: 1 } : {} } : {}) })}
                options={[
                  { value: '', label: 'Selecciona una acción…' },
                  ...[...methods].sort((a, b) => Number(actions.includes(b)) - Number(actions.includes(a))).map((m) => ({ value: m, label: METHOD_LABELS[m] ?? m })),
                ]}
                placeholder="Selecciona un método…"
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                {actions.includes(method) ? 'Esta acción trabaja con tus archivos. Al activar un flujo programado se ejecutará automáticamente con los datos completos.' : 'Esta consulta lee información que puedes usar en los siguientes pasos.'}
              </p>
              {batchPanel && actions.includes(method) && <div>
                <FieldLabel>Entradas conectadas</FieldLabel>
                <ThemedSelect aria-label="Entradas conectadas" value={String(node.config.input_mode ?? 'all')}
                  options={[{ value: 'all', label: 'Esperar todas las entradas' }, { value: 'any', label: 'Aceptar cualquier rama activa' }]}
                  onChange={(value) => patchConfig({ input_mode: value })} />
              </div>}
              </div>
            </details>
            <div>
              {!batchPanel && <FieldLabel>Datos para la acción</FieldLabel>}
              {!batchPanel && actions.includes(method) && <div className="mb-3">
                <FieldLabel>Entradas conectadas</FieldLabel>
                <ThemedSelect aria-label="Entradas conectadas" value={String(node.config.input_mode ?? 'all')}
                  options={[{ value: 'all', label: 'Esperar todas las entradas' }, { value: 'any', label: 'Aceptar cualquier rama activa' }]}
                  onChange={(value) => patchConfig({ input_mode: value })} />
              </div>}
              {method === 'flows_read_images' && <div className={batchPanel ? 'space-y-4' : 'space-y-3'}>
                {reportBatch && <div>
                  <FieldLabel>Plantilla del lote</FieldLabel>
                  <ThemedSelect aria-label="Plantilla del lote" value={String(args.report_template)} options={templates}
                    onChange={(value) => patchArgs({ report_template: value })} />
                </div>}
                {batchPanel && <h3 className="border-t border-[var(--border-subtle)] pt-4 text-sm font-medium text-[var(--text-primary)]">Archivos del lote</h3>}
                {(['source_folder', 'output_folder', 'spreadsheet_path'] as const).map((key) => <div key={key}>
                  <FieldLabel>{key === 'source_folder' ? 'Carpeta de imágenes' : key === 'output_folder' ? 'Carpeta de salida' : reportBatch ? 'Excel común del lote' : 'Excel de datos (opcional)'}</FieldLabel>
                  <div className={batchPanel ? 'flex items-center gap-1.5' : ''}>
                    <Input readOnly aria-label={key} value={String(args[key] ?? '')} title={batchPanel ? String(args[key] ?? '') : undefined} placeholder="Selecciona con el botón…"
                      className={batchPanel ? 'min-w-0 flex-1 text-xs' : ''} />
                    <Button variant={batchPanel ? 'ghost' : 'secondary'} size="sm" className={batchPanel ? 'shrink-0 !rounded-lg !px-2' : ''}
                      aria-label={`Seleccionar ${key === 'spreadsheet_path' ? 'Excel' : key === 'source_folder' ? 'origen' : 'destino'}`}
                      title={batchPanel ? `Seleccionar ${key === 'spreadsheet_path' ? 'Excel' : key === 'source_folder' ? 'origen' : 'destino'}` : undefined}
                      onClick={() => void choosePath(key, key !== 'spreadsheet_path')}>
                      {batchPanel ? key === 'spreadsheet_path' ? <FileSpreadsheet size={16} /> : <FolderOpen size={16} /> : `Seleccionar ${key === 'spreadsheet_path' ? 'Excel' : key === 'source_folder' ? 'origen' : 'destino'}`}
                    </Button>
                    {key === 'spreadsheet_path' && args[key] ? <Button variant="ghost" size="sm" aria-label="Quitar Excel" title={batchPanel ? 'Quitar Excel' : undefined}
                      className={batchPanel ? 'shrink-0 !rounded-lg !px-2' : ''} onClick={() => patchArgs({ [key]: '' })}>{batchPanel ? <X size={14} /> : 'Quitar Excel'}</Button> : null}
                  </div>
                </div>)}
                {(reportBatch ? imageLimit ? ['images_per_panel'] as const : [] : ['expected_images', 'images_per_panel'] as const).map((key) => <div key={key}>
                  <FieldLabel>{reportBatch ? `Fotos esperadas por fila (1 a ${imageLimit})` : key === 'expected_images' ? 'Imágenes mínimas para iniciar' : 'Imágenes por panel'}</FieldLabel>
                  <Input aria-label={key} className={batchPanel ? 'w-full text-xs' : ''} type="number" min={1} max={reportBatch ? imageLimit : 1000} value={reportBatch ? Math.min(imageLimit, Number(args[key] ?? 6)) : Number(args[key] ?? 1)} onChange={(e) => patchArgs({ [key]: Math.max(1, reportBatch ? Math.min(imageLimit, Math.round(Number(e.target.value))) : Math.round(Number(e.target.value))) })} />
                </div>)}
                {reportBatch ? <>
                  <p className="text-pretty text-xs leading-5 text-[var(--text-secondary)]">Un PDF con las páginas propias de la plantilla.{imageLimit ? ' Fotos por OT y fecha, incluidas las subcarpetas.' : ' Esta plantilla no requiere fotos.'}</p>
                  <Button variant="primary" size="sm" className="w-full !rounded-lg" disabled={previewing || !args.source_folder || !args.output_folder || !args.spreadsheet_path} onClick={() => void previewBatch()}>
                    {previewing ? 'Preparando…' : 'Revisar lote'}
                  </Button>
                  {batchPreview && <div className="space-y-4">
                    <div className="flex items-start gap-2 text-xs leading-5" role="status">
                      {batchPreview.ready && !previewStale ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--accent-green)]" /> : <AlertCircle size={15} className="mt-0.5 shrink-0 text-[var(--accent-yellow)]" />}
                      <p className="text-[var(--text-secondary)]">{previewStale ? 'Hay cambios: vuelve a revisar el lote antes de ejecutarlo.' : batchPreview.reason}</p>
                    </div>
                    {batchPreview.headers && <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-medium text-[var(--text-primary)]">Mapeo de columnas</h3>
                        <Button variant="ghost" size="sm" aria-label="Aplicar mapeo sugerido" onClick={() => patchArgs({ field_mappings: { ...batchPreview.suggested_mappings, ...Object.fromEntries(Object.entries(mappings).filter(([, column]) => batchPreview.headers?.includes(column))) } })}>Autocompletar</Button>
                      </div>
                      {[true, false].map((requiredGroup) => {
                        const fields = Object.keys(batchPreview.suggested_mappings ?? {}).filter((field) =>
                          (field === 'OT' || field === 'FECHA_TRABAJO' || !!batchPreview.required_fields?.includes(field)) === requiredGroup);
                        if (!fields.length) return null;
                        const controls = <div className="space-y-3">{fields.map((field) => <div key={field} className="grid grid-cols-2 items-center gap-3">
                          <FieldLabel><span className="block truncate" title={batchPreview.field_labels?.[field] ?? field}>{field === 'FECHA_TRABAJO' ? 'Fecha del trabajo' : batchPreview.field_labels?.[field] ?? field}{requiredGroup && <span className="ml-1 text-[var(--text-muted)]" title="Obligatorio">*</span>}</span></FieldLabel>
                          <ThemedSelect aria-label={`Columna para ${field}`} value={mappings[field] ?? ''}
                            options={[{ value: '', label: 'Sin asignar' }, ...new Set([...(batchPreview.headers ?? []), ...(mappings[field] ? [mappings[field]] : [])])].map((value) => typeof value === 'string' ? { value, label: `${value}${batchPreview.headers?.includes(value) ? '' : ' (columna ausente)'}` } : value)}
                            onChange={(column) => patchArgs({ field_mappings: { ...mappings, [field]: column } })} />
                        </div>)}</div>;
                        return requiredGroup ? <div key="required">{controls}</div> : <details key="optional" className="space-y-3">
                          <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">Campos de la plantilla ({fields.length})</summary>{controls}
                        </details>;
                      })}
                    </div>}
                    {!!batchPreview.missing_mappings?.length && <p role="alert" className="text-xs text-[var(--accent-red)]">Revisa el mapeo: {batchPreview.missing_mappings.join(', ')}</p>}
                    {(!batchPreview.ready || previewStale) && <p className="text-xs leading-5 text-[var(--text-secondary)]">Exportación bloqueada hasta resolver los pendientes y volver a revisar.</p>}
                    {args.report_template === 'fichas_tecnicas/ficha_tecnica.html' && <p className="text-xs text-[var(--text-secondary)]">Las columnas de productos y personal técnico admiten listas en formato JSON.</p>}
                    {batchPreview.preview && <details className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
                      <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">Revisión de filas · {batchPreview.preview.length}</summary>
                      <p className="text-xs leading-5 text-[var(--text-secondary)]">{args.report_template === 'report.html' ? `${batchPreview.preview.length} filas = ${batchPreview.preview.length} páginas.` : `${batchPreview.preview.length} registros en un único PDF consolidado.`} {batchPreview.ready && !previewStale && 'Todas las filas están completas.'}</p>
                    {batchPreview.preview?.map((row) => <details key={row.row_index} className="rounded border border-[var(--border-medium)] p-2">
                      <summary className="cursor-pointer text-xs text-[var(--text-primary)]">Fila {row.row_index + 1} · OT {row.ot || 'sin asignar'} · {row.date || 'sin fecha'}</summary>
                      <dl className="my-2 text-xs text-[var(--text-secondary)]">{Object.entries(row.data).map(([field, value]) => <div key={field}><dt className="inline font-medium">{field}: </dt><dd className="inline break-words">{value || '—'}</dd></div>)}</dl>
                      {row.errors.map((error) => <p key={error} className="text-xs text-[var(--accent-red)]">{error}</p>)}
                      {imageLimit > 0 && <p className="my-2 text-xs text-[var(--text-secondary)]">{row.images.length} fotos seleccionadas. Abre las opciones para sustituirlas o resolver coincidencias.</p>}
                      {row.candidates.map((name) => {
                        const selected = selections[String(row.row_index)] ?? row.images;
                        return <label key={name} className="flex items-start gap-2 py-1 text-xs text-[var(--text-secondary)]">
                          <Input type="checkbox" className="h-4 w-4 shrink-0 p-0" aria-label={`Fila ${row.row_index + 1}: ${name}`} checked={selected.includes(name)} disabled={!selected.includes(name) && selected.length >= imageLimit}
                            onChange={(e) => patchArgs({ photo_selections: { ...selections, [String(row.row_index)]: e.target.checked ? [...selected, name] : selected.filter((photo) => photo !== name) } })} />
                          <span className="min-w-0 break-all">{name}</span>
                        </label>;
                      })}
                      {imageLimit > 0 && <Button variant="ghost" size="sm" onClick={() => patchArgs({ photo_selections: { ...selections, [String(row.row_index)]: selections[String(row.row_index)] ?? row.images } })}>Confirmar fotos de esta fila</Button>}
                    </details>)}
                    </details>}
                  </div>}
                </> : <>
                <FieldLabel>Columna que identifica cada panel (opcional)</FieldLabel>
                <Input aria-label="key_column" value={String(args.key_column ?? '')} placeholder="ID" onChange={(e) => patchArgs({ key_column: e.target.value })} />
                <p className="text-xs text-[var(--text-secondary)]">Espera el lote completo y 15 segundos sin cambios. Con Excel, usa la columna ID para asociar cada fila con los nombres de sus imágenes; sin ella se usa el orden de las filas.</p>
                </>}
              </div>}
              {templates.length > 0 && method !== 'flows_read_images' && <div className="mb-3">
                <FieldLabel>Plantilla guardada</FieldLabel>
                <ThemedSelect aria-label="Plantilla guardada" value={String(args[method === 'canvas_get' ? 'id' : method === 'formatos_generate' ? 'format_id' : method === 'template_get' ? 'name' : 'template_name'] ?? '')}
                  options={[{ value: '', label: 'Selecciona una plantilla…' }, ...templates]}
                  onChange={(value) => patchArgs({ [method === 'canvas_get' ? 'id' : method === 'formatos_generate' ? 'format_id' : method === 'template_get' ? 'name' : 'template_name']: value })} />
              </div>}
              {method !== 'flows_read_images' && <>
              {method === 'flows_print_pdf' && <div className="mb-3 space-y-2">
                <FieldLabel>Impresora</FieldLabel>
                <ThemedSelect aria-label="Impresora" value={String(args.printer_name ?? '')}
                  options={[{ value: '', label: 'Selecciona una impresora…' }, ...printers.map((p) => ({ value: p.name, label: `${p.name}${p.default ? ' (predeterminada)' : ''}` }))]}
                  onChange={(printer_name) => patchArgs({ printer_name })} />
                <FieldLabel>Copias</FieldLabel><Input aria-label="Copias" type="number" min={1} max={99} value={Number(args.copies ?? 1)} onChange={(e) => patchArgs({ copies: Math.max(1, Math.min(99, Math.round(Number(e.target.value)))) })} />
                <FieldLabel>Páginas</FieldLabel><Input aria-label="Páginas" value={String(args.pages ?? '')} placeholder="Todas — p. ej. 1-3,5" spellCheck={false}
                  onChange={(e) => patchArgs({ pages: e.target.value || undefined })} />
                <FieldLabel>Dúplex</FieldLabel>
                <ThemedSelect aria-label="Dúplex" value={String(args.duplex ?? 'none')}
                  options={[{ value: 'none', label: 'Una cara' }, { value: 'long_edge', label: 'Ambas caras (borde largo)' }, { value: 'short_edge', label: 'Ambas caras (borde corto)' }]}
                  onChange={(duplex) => patchArgs({ duplex: duplex === 'none' ? undefined : duplex })} />
                <FieldLabel>Calidad</FieldLabel>
                <ThemedSelect aria-label="Calidad" value={String(args.quality ?? 'normal')}
                  options={[{ value: 'draft', label: 'Borrador (rápida)' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Alta' }]}
                  onChange={(quality) => patchArgs({ quality: quality === 'normal' ? undefined : quality })} />
                <p className="text-xs text-[var(--text-secondary)]">Al completar el flujo, envía el PDF a la cola de Windows. La impresora elegida debe estar disponible.</p>
              </div>}
              {METHOD_FIELDS[method]?.filter((key) => ['destino', 'output_folder', 'outputDir', 'output_path', 'outputPath', 'pdf_path', 'stamp_path', 'spreadsheet_path', 'excelPath'].includes(key)).map((key) => <Button key={key} variant="secondary" size="sm" className="mb-2" onClick={() => void choosePath(key, /folder|destino|outputDir/.test(key), /output.*[Pp]ath/.test(key))}>Elegir {({ destino: 'carpeta de salida', output_folder: 'carpeta de salida', outputDir: 'carpeta de salida', output_path: 'archivo de salida', outputPath: 'archivo de salida', pdf_path: 'PDF', stamp_path: 'sello', spreadsheet_path: 'Excel', excelPath: 'Excel' } as Record<string, string>)[key] ?? 'archivo'}</Button>)}
              <fieldset disabled={!!fieldError}>
                <ObjectFieldsEditor value={method === 'flows_print_pdf' ? Object.fromEntries(Object.entries(args).filter(([key]) => !['printer_name', 'copies', 'pages', 'duplex', 'quality'].includes(key))) : node.config.args} fields={METHOD_FIELDS[String(node.config.method ?? '')]?.filter((key) => method !== 'flows_print_pdf' || !['printer_name', 'copies', 'pages', 'duplex', 'quality'].includes(key))} sources={sources} onChange={(data) => patchConfig({ args: method === 'flows_print_pdf' ? { printer_name: args.printer_name, copies: args.copies ?? 1, pages: args.pages, duplex: args.duplex, quality: args.quality, ...data } : data })} />
              </fieldset>
              </>}
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">Argumentos avanzados (JSON)</summary>
              <FieldLabel>Argumentos (JSON)</FieldLabel>
              <Textarea
                key={JSON.stringify(node.config.args)}
                data-json
                defaultValue={node.config.args ? JSON.stringify(node.config.args, null, 2) : ''}
                rows={6}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder='{ "id": "=nodes.trigger.json" }'
                onBlur={(e) => parseJsonField(e.target.value, (v) => patchConfig({ args: v }), 'Argumentos')}
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Las cadenas que empiezan por = se evalúan: =item, =items, =nodes.&lt;id&gt;.json, =run.trigger.
              </p>
            </details>
          </>
        )}

        {node.kind === 'condition' && (
          <>
            <div>
              <FieldLabel>Campo a evaluar</FieldLabel>
              <ThemedSelect aria-label="Dato a evaluar" value={String(node.config.field ?? '')}
                options={[{ value: '', label: 'Elige datos de un paso conectado…' }, ...sources,
                  ...(node.config.field && !sources.some((s) => s.value === node.config.field) ? [{ value: String(node.config.field), label: 'Expresión personalizada' }] : [])]}
                onChange={(field) => patchConfig({ field })} />
              <details>
              <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">Expresión avanzada</summary>
              <Input
                value={String(node.config.field ?? '')}
                onChange={(e) => patchConfig({ field: e.target.value })}
                placeholder="=nodes.n1.json.total"
                spellCheck={false}
                className="font-mono text-xs"
              />
              </details>
            </div>
            <div>
              <FieldLabel>Operador</FieldLabel>
              <ThemedSelect
                value={String(node.config.op ?? 'eq')}
                onChange={(v) => patchConfig({ op: v })}
                options={CONDITION_OPS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
            <div>
              <FieldLabel>Valor de comparación</FieldLabel>
              <ObjectFieldsEditor value={{ value: node.config.value }} fields={['value']} sources={sources} allowAdd={false}
                onChange={(data) => { patchConfig({ value: data.value }); setComparisonRevision((revision) => revision + 1); }} />
              <details className="mt-2">
              <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">Valor avanzado</summary>
              <Input
                key={comparisonRevision}
                defaultValue={node.config.value === undefined ? '' : typeof node.config.value === 'string' ? node.config.value : JSON.stringify(node.config.value)}
                onChange={(e) => {
                  const raw = e.target.value;
                  let value: unknown = raw === '' ? undefined : raw;
                  try {
                    value = JSON.parse(raw);
                  } catch {
                    // Las expresiones y el texto sin comillas se conservan literalmente.
                  }
                  patchConfig({ value });
                }}
                placeholder="10 o =run.trigger.umbral"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Usa = para comparar contra otra expresión.
              </p>
              </details>
            </div>
          </>
        )}

        {node.kind === 'http_request' && (
          <>
            <div>
              <FieldLabel>URL</FieldLabel>
              <Input
                value={String(node.config.url ?? '')}
                onChange={(e) => patchConfig({ url: e.target.value })}
                placeholder="https://api.ejemplo.com/datos"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Solo http/https; admite expresiones =…
              </p>
            </div>
            <div>
              <FieldLabel>Método</FieldLabel>
              <ThemedSelect
                value={String(node.config.method ?? 'GET')}
                onChange={(v) => patchConfig({ method: v })}
                options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => ({
                  value: m,
                  label: m,
                }))}
              />
            </div>
            <div>
              <FieldLabel>Conexión</FieldLabel>
              <ThemedSelect
                value={String(node.config.connection_ref ?? '')}
                onChange={(v) => patchConfig({ connection_ref: v || undefined })}
                options={[
                  { value: '', label: 'Sin cuenta conectada' },
                  ...connections.map((c) => ({
                    value: c.id,
                    label: c.connected ? c.label : `${c.label} (no conectada)`,
                  })),
                ]}
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Usa una cuenta guardada para acceder al servicio. Puedes añadirla en la sección Conexiones.
              </p>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">Opciones avanzadas de la solicitud</summary>
              <div className="mt-3 space-y-4">
            <div>
              <FieldLabel>Cabeceras (JSON)</FieldLabel>
              <Textarea
                key={node.id}
                data-json
                defaultValue={node.config.headers ? JSON.stringify(node.config.headers, null, 2) : ''}
                rows={4}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder='{ "Accept": "application/json" }'
                onBlur={(e) => parseJsonField(e.target.value, (v) => patchConfig({ headers: v }), 'Cabeceras')}
              />
            </div>
            <div>
              <FieldLabel>Datos a enviar (JSON)</FieldLabel>
              <Textarea
                key={node.id}
                data-json
                defaultValue={node.config.body != null ? JSON.stringify(node.config.body, null, 2) : ''}
                rows={5}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder='{ "texto": "=nodes.n1.json.title" }'
                onBlur={(e) => parseJsonField(e.target.value, (v) => patchConfig({ body: v }), 'Cuerpo')}
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Para enviar texto, escríbelo entre comillas. Deja vacío si no quieres enviar datos.
              </p>
            </div>
            <div>
              <FieldLabel>Ante un error HTTP</FieldLabel>
              <ThemedSelect aria-label="Ante un error HTTP" value={node.config.fail_on_http_error === false ? 'continue' : 'fail'}
                options={[{ value: 'fail', label: 'Marcar el paso como fallido' }, { value: 'continue', label: 'Continuar y consultar la respuesta' }]}
                onChange={(value) => patchConfig({ fail_on_http_error: value === 'fail' })} />
            </div>
            <div>
              <FieldLabel>Timeout (segundos)</FieldLabel>
              <Input
                type="number"
                min={1}
                max={60}
                value={Number(node.config.timeout_s ?? 20)}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isFinite(value)) patchConfig({ timeout_s: value });
                }}
              />
            </div>
              </div>
            </details>
          </>
        )}

        {node.kind === 'switch' && <SwitchConfigEditor node={node} patchConfig={patchConfig} sources={sources} />}

        {node.kind === 'agent' && <AgentConfigEditor node={node} patchConfig={patchConfig} sources={sources} />}

        {node.kind === 'mcp_call' && <McpCallConfigEditor node={node} patchConfig={patchConfig} sources={sources} invalid={!!fieldError} />}

        {node.kind === 'loop' && (
          <>
            <div>
              <FieldLabel>Repetir sobre</FieldLabel>
              <ThemedSelect aria-label="Lista a recorrer" value={String(node.config.over ?? '')}
                options={[{ value: '', label: 'La lista recibida del paso anterior' }, ...sources,
                  ...(node.config.over && !sources.some((s) => s.value === node.config.over) ? [{ value: String(node.config.over), label: 'Expresión personalizada' }] : [])]}
                onChange={(over) => patchConfig({ over: over || undefined })} />
              <details>
              <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">Expresión avanzada</summary>
              <Input
                value={String(node.config.over ?? '')}
                onChange={(e) => patchConfig({ over: e.target.value || undefined })}
                placeholder="=nodes.n1.json.filas"
                spellCheck={false}
                className="font-mono text-xs"
              />
              </details>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Cada elemento recorre los pasos conectados a «Cada elemento»; al terminar la lista, la ejecución continúa por «Al terminar». Dentro del cuerpo puedes usar =loop.item, =loop.index y =loop.count.
              </p>
            </div>
            <div>
              <FieldLabel>Máximo de elementos</FieldLabel>
              <Input
                type="number"
                min={1}
                max={1000}
                value={Number(node.config.max_items ?? 100)}
                onChange={(e) => {
                  const value = Math.round(Number(e.target.value));
                  if (Number.isFinite(value)) patchConfig({ max_items: Math.min(Math.max(value, 1), 1000) });
                }}
              />
            </div>
          </>
        )}

        {node.kind === 'code' && (
          <>
            <div>
              <FieldLabel>Código Python</FieldLabel>
              <Textarea
                value={String(node.config.code ?? '')}
                rows={10}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={'result = item * 2'}
                onChange={(e) => patchConfig({ code: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Variables: <code>item</code>, <code>items</code>, <code>nodes</code>, <code>run</code> y <code>loop</code>. Deja el resultado en la variable <code>result</code>. Se ejecuta en un proceso aparte con tu usuario.
              </p>
            </div>
            <div>
              <FieldLabel>Tiempo máximo (segundos)</FieldLabel>
              <Input
                type="number"
                min={1}
                max={300}
                value={Number(node.config.timeout_s ?? 30)}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isFinite(value)) patchConfig({ timeout_s: Math.min(Math.max(value, 1), 300) });
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={node.config.auto_approve === true}
                onChange={(e) => patchConfig({ auto_approve: e.target.checked ? true : undefined })}
                className="accent-[var(--accent-primary)]"
              />
              Ejecutar el código sin pedir aprobación
            </label>
            <p className="-mt-2 text-[11px] text-[var(--text-secondary)]">
              Cada ejecución pausa en Ejecuciones hasta que apruebes este código; actívalo solo si el flujo debe correr desatendido.
            </p>
          </>
        )}

        {node.kind === 'transform' && (
          <div className="space-y-3">
            <FieldLabel>Campos del resultado</FieldLabel>
            <fieldset disabled={!!fieldError}>
              <ObjectFieldsEditor value={node.config.output} sources={sources} onChange={(output) => patchConfig({ output })} />
            </fieldset>
            <details>
            <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">Resultado avanzado (JSON)</summary>
            <FieldLabel>Objeto de salida (JSON)</FieldLabel>
            <Textarea
              key={JSON.stringify(node.config.output)}
              data-json
              defaultValue={node.config.output ? JSON.stringify(node.config.output, null, 2) : ''}
              rows={8}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={'{\n  "nombre": "=item.json.name",\n  "total": 0\n}'}
              onBlur={(e) => parseJsonField(e.target.value, (v) => patchConfig({ output: v }), 'Salida')}
            />
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Cada cadena =... se reemplaza por su valor evaluado.
            </p>
            </details>
          </div>
        )}

        {def.implemented && node.kind !== 'trigger' && (!actions.includes(method) || method === 'flows_read_images') && (
          <RetryConfigEditor node={node} onChange={onChange} />
        )}

        {!def.implemented && node.kind !== 'trigger' && (
          <p className="rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-secondary)]">
            Este tipo de nodo aún no se puede ejecutar. Producirá un error si recibe datos de entrada.
          </p>
        )}
      </div>
    </aside>
  );
}
