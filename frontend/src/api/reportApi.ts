export interface ReportApiSpec<TReport> {
  list: (params: { summary: boolean }) => Promise<Record<string, unknown>>;
  get: (id: string) => Promise<Record<string, unknown>>;
  create: (item?: Partial<TReport>) => Promise<Record<string, unknown>>;
  update: (id: string, item: Partial<TReport>) => Promise<Record<string, unknown>>;
  delete: (id: string) => Promise<unknown>;
  clear: () => Promise<unknown>;
  importFile: (params: { filename: string; content_b64: string }) => Promise<{ imported_count: number }>;
}

export interface ReportListResult<TListItem> {
  reports: TListItem[];
  total?: number;
}

// Wire convention (H2): report handlers return { items, total } for lists,
// { item } for get/create/update and { deleted_id } for deletes; the factory
// exposes them to the UI as `reports`.
export function createReportApi<TReport, TListItem>(
  spec: ReportApiSpec<TReport>,
) {
  return {
    list: async (summary = true): Promise<ReportListResult<TListItem>> => {
      const result = await spec.list({ summary });
      const reports = (result.items ?? []) as TListItem[];
      return typeof result.total === 'number' ? { reports, total: result.total } : { reports };
    },
    get: async (id: string) => (await spec.get(id)).item as TReport,
    create: async (item?: Partial<TReport>) => (await spec.create(item)).item as TReport,
    update: async (id: string, item: TReport) => (await spec.update(id, item)).item as TReport,
    delete: (id: string) => spec.delete(id),
    clear: () => spec.clear(),
    importFile: (filename: string, content_b64: string) => spec.importFile({ filename, content_b64 }),
  };
}
