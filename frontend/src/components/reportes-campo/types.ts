export type ReportType = 'panel-fotografico' | 'desinfeccion-reservorios' | 'maquina-balde';

export interface PhotoFile {
    id: string;
    file: File;
    previewUrl: string;
}

export interface LogoData {
    file: File;
    url: string;
}

export interface FieldDef {
    key: string;
    label: string;
    wide?: boolean;
    multiline?: boolean;
    rows?: number;
    type?: string;
    section?: 'generales' | 'localizacion' | 'trabajo';
    required?: boolean;
}

export interface ReportTypeConfig {
    id: ReportType;
    label: string;
    shortLabel: string;
    icon: string;
    filename: string;
    defaultTitulo: string;
    fields: FieldDef[];
    infoBarItems: Array<{ label: string; valueKey: string; format?: (v: string) => string }>;
    localizacionRows: Array<Array<{ label: string; valueKey: string; colSpan?: number }>>;
    trabajoSection?: {
        title: string;
        rows: Array<Array<{ label: string; valueKey: string; colSpan?: number }>>;
    };
    pageLabelFormat: 'hoja' | 'pagina';
    photosPerPage?: number;
    gridColumns?: number;
    gridRows?: number;
}

export type HeaderMap = Record<string, string>;

export interface CampoPanel {
    id: string;
    label: string;
    header: HeaderMap;
    photos: PhotoFile[];
    createdAt: number;
}

export interface CampoPanelListItem {
    id: string;
    label: string;
    photoCount: number;
    pageCount: number;
}

export interface StoredPhoto {
    id: string;
    name: string;
    type: string;
    blob: Blob;
}

export interface StoredPanel {
    id: string;
    reportType: ReportType;
    label: string;
    header: HeaderMap;
    createdAt: number;
    updatedAt: number;
    photos: StoredPhoto[];
}

export interface StoredBranding {
    reportType: ReportType;
    logoLeft: StoredPhoto | null;
    logoRight: StoredPhoto | null;
    updatedAt: number;
}
