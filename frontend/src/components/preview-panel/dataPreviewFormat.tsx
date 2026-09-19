export function getColumnWidthClass(header: string): string {
  const h = header.toUpperCase().trim();
  if (h === 'ID' || h === 'NIS' || h === 'OT' || h.includes('NRO') || h === 'SECTOR' || h === 'CUADRILLA') {
    return 'min-w-[96px]';
  }
  if (h.includes('OBSERVACION') || h.includes('OBS') || h.includes('DETALLE') || h.includes('DESCRIPCION')) {
    return 'min-w-[200px] max-w-[360px]';
  }
  if (h.includes('DIRECCION') || h.includes('UBICACION')) {
    return 'min-w-[180px] max-w-[300px]';
  }
  if (h.includes('ACTIVIDAD') || h.includes('TRABAJO')) {
    return 'min-w-[180px] max-w-[280px]';
  }
  if (h.includes('ESTADO') || h.includes('STATUS')) {
    return 'min-w-[120px]';
  }
  if (h.includes('CONTRATA') || h.includes('LOCALIDAD') || h.includes('DISTRITO') || h.includes('CENTRO') || h.includes('RED')) {
    return 'min-w-[120px]';
  }
  if (h.includes('FECHA') || h.includes('DATE') || h.includes('CORTE')) {
    return 'min-w-[104px]';
  }
  return h.length > 15 ? 'min-w-[150px]' : 'min-w-[110px]';
}

export function isMonospaceColumn(header: string): boolean {
  const h = header.toUpperCase();
  return h === 'ID' || h === 'NIS' || h === 'OT' || h.includes('NRO') || h.includes('CODIGO') || h === 'SECTOR' || h === 'CUADRILLA';
}

export function HighlightMatch({ text, query }: { text: string; query: string }) {
  const cleanQuery = query.trim();
  if (!cleanQuery || !text) return <span>{text}</span>;

  try {
    const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    return (
      <span>
        {parts.map((part, i) =>
          part.toLowerCase() === cleanQuery.toLowerCase() ? (
            <mark
              key={i}
              className="rounded-[2px] bg-[color:color-mix(in_srgb,var(--accent-primary)_30%,transparent)] text-[var(--text-primary)] px-0.5 font-semibold"
            >
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </span>
    );
  } catch {
    return <span>{text}</span>;
  }
}

export function renderStatusBadge(value: string, query = '') {
  const normalized = value.trim().toUpperCase();
  if (['ATENDIDO', 'COMPLETO', 'COMPLETADO', 'EJECUTADO', 'FINALIZADO', 'OK', 'APROBADO', 'ACTIVO'].includes(normalized)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[color:color-mix(in_srgb,var(--accent-green)_15%,transparent)] text-[var(--accent-green)] whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
        <HighlightMatch text={value} query={query} />
      </span>
    );
  }
  if (['PENDIENTE', 'EN PROCESO', 'EN CURSO', 'INICIADO', 'ASIGNADO', 'REVISION', 'EN ESPERA'].includes(normalized)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[color:color-mix(in_srgb,var(--accent-yellow)_15%,transparent)] text-[var(--accent-yellow)] whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-yellow)]" />
        <HighlightMatch text={value} query={query} />
      </span>
    );
  }
  if (['CANCELADO', 'ANULADO', 'RECHAZADO', 'NO ATENDIDO', 'URGENTE', 'ERROR', 'BAJA'].includes(normalized)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[color:color-mix(in_srgb,var(--accent-red)_15%,transparent)] text-[var(--accent-red)] whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-red)]" />
        <HighlightMatch text={value} query={query} />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap">
      <HighlightMatch text={value} query={query} />
    </span>
  );
}
