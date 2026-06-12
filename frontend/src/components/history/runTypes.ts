import type { TFunction } from 'i18next';

export interface HistoryRunRow {
  id: number;
  run_type: string;
  timestamp: string;
  formato: string;
  calidad: number;
  ok_count: number;
  err_count: number;
  patron: string;
  files_json: string;
  options_json: string;
  schema_version?: number | null;
  app_version?: string | null;
  duration_ms?: number | null;
}

export interface StatField {
  key: string;
  labelKey: string;
  resolve: (
    run: HistoryRunRow,
    files: string[],
    options: Record<string, unknown>,
  ) => string | number;
  colorClass?: string;
}

export interface RunTypeMeta {
  id: string;
  labelKey: string;
  descriptionKey: string;
  colorClass: string;
  badgeClass: string;
  stats: StatField[];
  showPatron: boolean;
  showOptions: boolean;
  filterGroup: 'default' | 'hidden';
  reexecute: boolean;
  fileListKey: string;
  listSummary?: (
    run: HistoryRunRow,
    files: string[],
    options: Record<string, unknown>,
    t: TFunction,
  ) => { parts: string[] };
}

export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function opt(options: Record<string, unknown>, key: string): unknown {
  return options[key];
}

const stat = (
  key: string,
  labelKey: string,
  resolve: StatField['resolve'],
  colorClass?: string,
): StatField => ({ key, labelKey, resolve, colorClass });

const RUN_TYPES = {
  conversion: {
    id: 'conversion',
    labelKey: 'history.runTypes.conversion',
    descriptionKey: 'history.runTypes.conversionDesc',
    colorClass: 'text-[var(--accent-green)]',
    badgeClass:
      'text-[var(--accent-green)] border-[color:var(--accent-green)]/20 bg-[color:var(--accent-green)]/10',
    showPatron: true,
    showOptions: false,
    filterGroup: 'default' as const,
    reexecute: true,
    fileListKey: 'history.fileList.conversion',
    stats: [
      stat('formato', 'history.stats.format', (run) => run.formato || '—'),
      stat('calidad', 'history.stats.quality', (run) => `${run.calidad}%`),
      stat('ok', 'history.stats.ok', (run) => run.ok_count, 'text-[var(--accent-green)]'),
      stat(
        'err',
        'history.stats.err',
        (run) => run.err_count,
        'text-[var(--accent-red)]',
      ),
    ],
    listSummary: (run, files, _options, t) => ({
      parts: [
        run.formato,
        t('history.list.files', { count: files.length }),
        `${run.calidad}%`,
      ],
    }),
  },
  formato: {
    id: 'formato',
    labelKey: 'history.runTypes.formato',
    descriptionKey: 'history.runTypes.formatoDesc',
    colorClass: 'text-[var(--accent-primary)]',
    badgeClass:
      'text-[var(--accent-primary)] border-[color:var(--accent-primary)]/20 bg-[color:var(--accent-primary)]/10',
    showPatron: false,
    showOptions: true,
    filterGroup: 'default' as const,
    reexecute: false,
    fileListKey: 'history.fileList.formato',
    stats: [
      stat('formato', 'history.stats.format', (run) => run.formato || '—'),
      stat('desde', 'history.stats.from', (_run, _files, options) => String(opt(options, 'desde') ?? '?')),
      stat('hasta', 'history.stats.to', (_run, _files, options) => String(opt(options, 'hasta') ?? '?')),
      stat(
        'files',
        'history.stats.pages',
        (_run, files) => String(files.length),
        'text-[var(--accent-primary)]',
      ),
    ],
    listSummary: (run, files, _options, t) => ({
      parts: [run.formato, t('history.list.pages', { count: files.length })],
    }),
  },
  sellador: {
    id: 'sellador',
    labelKey: 'history.runTypes.sellador',
    descriptionKey: 'history.runTypes.selladorDesc',
    colorClass: 'text-amber-400',
    badgeClass: 'text-amber-400 border-amber-400/20 bg-amber-400/10',
    showPatron: false,
    showOptions: true,
    filterGroup: 'default' as const,
    reexecute: false,
    fileListKey: 'history.fileList.sellador',
    stats: [
      stat('file', 'history.stats.file', (run) => run.formato || '—'),
      stat(
        'stamps',
        'history.stats.stamps',
        (run, _files, options) => String(opt(options, 'stamp_count') ?? run.ok_count),
        'text-amber-400',
      ),
      stat('pages', 'history.stats.pagesStamped', (_run, _files, options) => {
        const stamped = opt(options, 'stamped_pages');
        return Array.isArray(stamped) ? stamped.join(', ') : '—';
      }),
      stat('seed', 'history.stats.seed', (_run, _files, options) => String(opt(options, 'seed') ?? '—')),
    ],
  },
  padron: {
    id: 'padron',
    labelKey: 'history.runTypes.padron',
    descriptionKey: 'history.runTypes.padronDesc',
    colorClass: 'text-[var(--accent-yellow)]',
    badgeClass:
      'text-[var(--accent-yellow)] border-[color:var(--accent-yellow)]/20 bg-[color:var(--accent-yellow)]/10',
    showPatron: false,
    showOptions: true,
    filterGroup: 'default' as const,
    reexecute: false,
    fileListKey: 'history.fileList.padron',
    stats: [
      stat('formato', 'history.stats.format', (run) => run.formato || '—'),
      stat(
        'items',
        'history.stats.items',
        (_run, files) => String(files.length),
        'text-[var(--accent-yellow)]',
      ),
      stat('ok', 'history.stats.ok', (run) => run.ok_count, 'text-[var(--accent-green)]'),
      stat('err', 'history.stats.err', (run) => run.err_count, 'text-[var(--accent-red)]'),
    ],
    listSummary: (_run, files, _options, t) => ({
      parts: [t('history.runTypes.padron'), t('history.list.items', { count: files.length })],
    }),
  },
  volante: {
    id: 'volante',
    labelKey: 'history.runTypes.volante',
    descriptionKey: 'history.runTypes.volanteDesc',
    colorClass: 'text-[var(--accent-secondary)]',
    badgeClass:
      'text-[var(--accent-secondary)] border-[color:var(--accent-secondary)]/20 bg-[color:var(--accent-secondary)]/10',
    showPatron: false,
    showOptions: true,
    filterGroup: 'default' as const,
    reexecute: false,
    fileListKey: 'history.fileList.volante',
    stats: [
      stat('formato', 'history.stats.format', (run) => run.formato || '—'),
      stat(
        'records',
        'history.stats.records',
        (_run, files) => String(files.length),
        'text-[var(--accent-secondary)]',
      ),
      stat('ok', 'history.stats.ok', (run) => run.ok_count, 'text-[var(--accent-green)]'),
      stat('err', 'history.stats.err', (run) => run.err_count, 'text-[var(--accent-red)]'),
    ],
    listSummary: (_run, files, _options, t) => ({
      parts: [t('history.runTypes.volante'), t('history.list.records', { count: files.length })],
    }),
  },
  image_optimizer: {
    id: 'image_optimizer',
    labelKey: 'history.runTypes.imageOptimizer',
    descriptionKey: 'history.runTypes.imageOptimizerDesc',
    colorClass: 'text-purple-400',
    badgeClass: 'text-purple-400 border-purple-400/20 bg-purple-400/10',
    showPatron: false,
    showOptions: true,
    filterGroup: 'default' as const,
    reexecute: false,
    fileListKey: 'history.fileList.image_optimizer',
    stats: [
      stat(
        'preset',
        'history.stats.preset',
        (_run, _files, options) => String(opt(options, 'preset') ?? 'custom'),
        'text-purple-400',
      ),
      stat('scope', 'history.stats.scope', (_run, _files, options) => String(opt(options, 'scope') ?? 'all')),
      stat('ok', 'history.stats.processed', (run) => run.ok_count, 'text-[var(--accent-green)]'),
      stat('err', 'history.stats.err', (run) => run.err_count, 'text-[var(--accent-red)]'),
    ],
    listSummary: (_run, files, _options, t) => ({
      parts: [t('history.runTypes.imageOptimizer'), t('history.list.files', { count: files.length })],
    }),
  },
  reporte_campo: {
    id: 'reporte_campo',
    labelKey: 'history.runTypes.reporteCampo',
    descriptionKey: 'history.runTypes.reporteCampoDesc',
    colorClass: 'text-orange-400',
    badgeClass: 'text-orange-400 border-orange-400/20 bg-orange-400/10',
    showPatron: false,
    showOptions: true,
    filterGroup: 'default' as const,
    reexecute: false,
    fileListKey: 'history.fileList.default',
    stats: [
      stat('cs', 'history.stats.cs', (_run, _files, options) => String(opt(options, 'cs') ?? '—')),
      stat(
        'contratista',
        'history.stats.contractor',
        (_run, _files, options) => String(opt(options, 'contratista') ?? '—'),
      ),
      stat('ok', 'history.stats.ok', (run) => run.ok_count, 'text-[var(--accent-green)]'),
      stat('err', 'history.stats.err', (run) => run.err_count, 'text-[var(--accent-red)]'),
    ],
  },
  panel_aviso_corte: {
    id: 'panel_aviso_corte',
    labelKey: 'history.runTypes.panelAvisoCorte',
    descriptionKey: 'history.runTypes.panelAvisoCorteDesc',
    colorClass: 'text-rose-400',
    badgeClass: 'text-rose-400 border-rose-400/20 bg-rose-400/10',
    showPatron: false,
    showOptions: true,
    filterGroup: 'default' as const,
    reexecute: false,
    fileListKey: 'history.fileList.default',
    stats: [
      stat(
        'strategy',
        'history.stats.strategy',
        (_run, _files, options) => String(opt(options, 'strategy') ?? '—'),
      ),
      stat(
        'key',
        'history.stats.keyColumn',
        (_run, _files, options) => String(opt(options, 'key_column') ?? '—'),
      ),
      stat('ok', 'history.stats.panels', (run) => run.ok_count, 'text-rose-400'),
      stat('err', 'history.stats.err', (run) => run.err_count, 'text-[var(--accent-red)]'),
    ],
  },
  informe_tecnico: {
    id: 'informe_tecnico',
    labelKey: 'history.runTypes.informeTecnico',
    descriptionKey: 'history.runTypes.informeTecnicoDesc',
    colorClass: 'text-cyan-400',
    badgeClass: 'text-cyan-400 border-cyan-400/20 bg-cyan-400/10',
    showPatron: false,
    showOptions: true,
    filterGroup: 'default' as const,
    reexecute: false,
    fileListKey: 'history.fileList.default',
    stats: [
      stat('cs', 'history.stats.cs', (_run, _files, options) => String(opt(options, 'cs') ?? '—')),
      stat(
        'contratista',
        'history.stats.contractor',
        (_run, _files, options) => String(opt(options, 'contratista') ?? '—'),
      ),
      stat('status', 'history.stats.status', (_run, _files, options) => String(opt(options, 'status') ?? '—')),
      stat('ok', 'history.stats.ok', (run) => run.ok_count, 'text-cyan-400'),
    ],
  },
} as const satisfies Record<string, RunTypeMeta>;

export { RUN_TYPES };

export type RunTypeId = keyof typeof RUN_TYPES;

export const UNKNOWN_RUN_TYPE: RunTypeMeta = {
  id: 'unknown',
  labelKey: 'history.runTypes._unknown',
  descriptionKey: 'history.runTypes._unknown',
  colorClass: 'text-[var(--text-muted)]',
  badgeClass:
    'text-[var(--text-muted)] border-[color:var(--text-muted)]/20 bg-[color:var(--text-muted)]/10',
  stats: [
    stat('formato', 'history.stats.format', (run) => run.formato || '—'),
    stat('ok', 'history.stats.ok', (run) => run.ok_count, 'text-[var(--accent-green)]'),
    stat('err', 'history.stats.err', (run) => run.err_count, 'text-[var(--accent-red)]'),
  ],
  showPatron: false,
  showOptions: false,
  filterGroup: 'hidden',
  reexecute: false,
  fileListKey: 'history.fileList.default',
};

export function getRunType(id: string): RunTypeMeta {
  return (RUN_TYPES as Record<string, RunTypeMeta>)[id] ?? UNKNOWN_RUN_TYPE;
}

export function getTypeFilters(t: TFunction): { label: string; value: RunTypeId | 'all' }[] {
  const entries = Object.values(RUN_TYPES) as RunTypeMeta[];
  return [
    { label: t('history.filters.all'), value: 'all' },
    ...entries
      .filter((meta) => meta.filterGroup !== 'hidden')
      .map((meta) => ({ label: t(meta.labelKey), value: meta.id as RunTypeId })),
  ];
}

export interface ResolvedStat {
  label: string;
  value: string | number;
  color?: string;
}

export function formatRunStats(run: HistoryRunRow, t: TFunction): ResolvedStat[] {
  const files = safeJsonParse<string[]>(run.files_json, []);
  const options = safeJsonParse<Record<string, unknown>>(run.options_json, {});
  const meta = getRunType(run.run_type || 'conversion');
  return meta.stats.map((statField) => ({
    label: t(statField.labelKey),
    value: statField.resolve(run, files, options),
    color: statField.colorClass,
  }));
}

export function schemaOptionKeys(meta: RunTypeMeta): Set<string> {
  // Frontend mirrors backend permissive schemas; keys declared in options are surfaced in UI.
  const backendKeys: Record<string, string[]> = {
    conversion: ['formato', 'calidad', 'resize', 'keep_exif'],
    formato: ['desde', 'hasta', 'format_id'],
    sellador: ['stamp_count', 'stamped_pages', 'seed', 'positions', 'x', 'y', 'width', 'height', 'source'],
    padron: ['excel_path', 'filtro'],
    volante: ['excel_path', 'plantilla'],
    image_optimizer: ['preset', 'scope', 'max_kb'],
    reporte_campo: ['cs', 'contratista'],
    panel_aviso_corte: ['key_column', 'strategy'],
    informe_tecnico: ['cs', 'contratista', 'status'],
  };
  return new Set(backendKeys[meta.id] ?? []);
}
