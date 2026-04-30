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
}

export type HeaderMap = Record<string, string>;
