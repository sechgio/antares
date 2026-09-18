import type { HeaderMap } from '../types';

export function derivePanelLabel(header: HeaderMap): string {
    const parts: string[] = [];
    const centro = header.CENTRO?.trim();
    const fecha = header.FECHA_TRABAJO?.trim();
    const nis = header.NIS?.trim();
    if (centro) parts.push(centro);
    if (fecha) parts.push(fecha);
    if (nis && !centro) parts.push(nis);
    if (parts.length === 0) return 'Panel nuevo';
    return parts.join(' · ');
}
