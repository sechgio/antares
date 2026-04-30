import type { ReportTypeConfig } from './types';

function formatDateDisplay(isoDate: string): string {
    if (!isoDate || !isoDate.trim()) return '';
    const parts = isoDate.trim().split('-');
    if (parts.length === 3) {
        const [year, month, day] = parts;
        return `${day}-${month}-${year}`;
    }
    return isoDate;
}

export const CHUNK_SIZE = 4;

export function chunkArray<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
    }
    return result;
}

export const REPORT_TYPES: ReportTypeConfig[] = [
    {
        id: 'panel-fotografico',
        label: 'Panel Fotográfico',
        shortLabel: 'Panel Foto.',
        icon: 'camera',
        filename: 'panel_fotografico.pdf',
        defaultTitulo: 'Panel Fotográfico',
        fields: [
            { key: 'titulo', label: 'Título del Reporte', wide: true, section: 'generales' },
            { key: 'CENTRO', label: 'Centro de Servicios', section: 'generales' },
            { key: 'FECHA_TRABAJO', label: 'Fecha de Trabajo', type: 'date', section: 'generales' },
            { key: 'DIRECCIONES_AFECTADAS', label: 'Direcciones Afectadas', wide: true, section: 'localizacion' },
            { key: 'DISTRITO', label: 'Distrito', section: 'localizacion' },
            { key: 'ESTADO', label: 'Estado', section: 'generales' },
            { key: 'ACTIVIDAD', label: 'Actividad', wide: true, multiline: true, rows: 1, section: 'trabajo' },
            { key: 'CUADRILLA', label: 'Cuadrilla', section: 'trabajo' },
        ],
        infoBarItems: [
            { label: 'Centro de Servicios', valueKey: 'CENTRO' },
            { label: 'Fecha de Trabajo', valueKey: 'FECHA_TRABAJO', format: formatDateDisplay },
            { label: 'Estado', valueKey: 'ESTADO' },
        ],
        localizacionRows: [
            [{ label: 'Direcciones Afectadas:', valueKey: 'DIRECCIONES_AFECTADAS', colSpan: 3 }],
            [{ label: 'Distrito:', valueKey: 'DISTRITO', colSpan: 3 }],
        ],
        trabajoSection: {
            title: '2.0 Detalles de Orden de Trabajo',
            rows: [
                [
                    { label: 'Actividad:', valueKey: 'ACTIVIDAD' },
                    { label: 'Cuadrilla:', valueKey: 'CUADRILLA' },
                ],
            ],
        },
        pageLabelFormat: 'hoja',
    },
    {
        id: 'desinfeccion-reservorios',
        label: 'Desinfección Reservorios',
        shortLabel: 'Desinf. Reserv.',
        icon: 'droplet',
        filename: 'desinfeccion_reservorios.pdf',
        defaultTitulo: 'Desinfección de Reservorios',
        fields: [
            { key: 'titulo', label: 'Título del Reporte', wide: true, section: 'generales' },
            { key: 'FECHA_TRABAJO', label: 'Fecha de Trabajo', type: 'date', section: 'generales' },
            { key: 'NIS', label: 'NIS', section: 'generales' },
            { key: 'SGIO', label: 'SGIO', section: 'generales' },
            { key: 'DIRECCION', label: 'Dirección', wide: true, section: 'localizacion' },
            { key: 'DISTRITO', label: 'Distrito', section: 'localizacion' },
        ],
        infoBarItems: [
            { label: 'Fecha de Trabajo', valueKey: 'FECHA_TRABAJO', format: formatDateDisplay },
            { label: 'NIS', valueKey: 'NIS' },
            { label: 'SGIO', valueKey: 'SGIO' },
        ],
        localizacionRows: [
            [{ label: 'Dirección:', valueKey: 'DIRECCION', colSpan: 3 }],
            [{ label: 'Distrito:', valueKey: 'DISTRITO', colSpan: 3 }],
        ],
        pageLabelFormat: 'hoja',
    },
    {
        id: 'maquina-balde',
        label: 'Máquina de Balde',
        shortLabel: 'Máq. Balde',
        icon: 'bucket',
        filename: 'maquina_balde.pdf',
        defaultTitulo: 'Máquina de Balde',
        fields: [
            { key: 'titulo', label: 'Título del Reporte', wide: true, section: 'generales' },
            { key: 'FECHA_TRABAJO', label: 'Fecha de Trabajo', type: 'date', section: 'generales' },
            { key: 'NIS', label: 'NIS', section: 'generales' },
            { key: 'SGIO', label: 'SGIO', section: 'generales' },
            { key: 'DIRECCION', label: 'Dirección', wide: true, multiline: true, rows: 1, section: 'localizacion' },
            { key: 'LOCALIDAD', label: 'Localidad', section: 'localizacion' },
            { key: 'DISTRITO', label: 'Distrito', section: 'localizacion' },
            { key: 'ACTIVIDAD', label: 'Actividad', wide: true, multiline: true, rows: 1, section: 'trabajo' },
        ],
        infoBarItems: [
            { label: 'Fecha de Trabajo', valueKey: 'FECHA_TRABAJO', format: formatDateDisplay },
            { label: 'NIS', valueKey: 'NIS' },
            { label: 'SGIO', valueKey: 'SGIO' },
        ],
        localizacionRows: [
            [{ label: 'Dirección:', valueKey: 'DIRECCION', colSpan: 3 }],
            [
                { label: 'Localidad:', valueKey: 'LOCALIDAD' },
                { label: 'Distrito:', valueKey: 'DISTRITO' },
            ],
        ],
        trabajoSection: {
            title: '2.0 Detalles de Orden de Trabajo',
            rows: [
                [{ label: 'Actividad:', valueKey: 'ACTIVIDAD', colSpan: 3 }],
            ],
        },
        pageLabelFormat: 'pagina',
    },
];

export function getReportConfig(id: string): ReportTypeConfig {
    return REPORT_TYPES.find((r) => r.id === id) ?? REPORT_TYPES[0];
}

export function getDefaultHeader(config: ReportTypeConfig): Record<string, string> {
    const header: Record<string, string> = {};
    for (const field of config.fields) {
        header[field.key] = field.key === 'titulo' ? config.defaultTitulo : '';
    }
    return header;
}
