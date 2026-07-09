export interface LocalImage {
  file: File;
  objectUrl: string;
  localPath?: string;
}

export interface LogoAsset {
  file: File;
  objectUrl: string;
}

export interface CuadranteRange {
  id: string;
  fromPage: number;
  toPage: number;
  cuadrante: string;
}

export interface EvidenciaSession {
  title: string;
  /** Etiqueta del bloque de cuadrante en el documento (p. ej. "CUADRANTE AFECTADO:"). */
  cuadranteLabel: string;
  /** Si false, la etiqueta no se renderiza (el valor del cuadrante sí). */
  showCuadranteLabel: boolean;
  cuadranteRanges: CuadranteRange[];
  logoLeft: LogoAsset | null;
  logoRight: LogoAsset | null;
  images: LocalImage[];
  updatedAt: number;
}

export interface StoredLogo {
  name: string;
  type: string;
  blob: Blob;
}

export interface StoredImage {
  name: string;
  type: string;
  blob: Blob;
  localPath?: string;
}

export interface StoredSession {
  title: string;
  cuadrante?: string;
  cuadranteLabel?: string;
  showCuadranteLabel?: boolean;
  cuadranteRanges?: CuadranteRange[];
  logoLeft: StoredLogo | null;
  logoRight: StoredLogo | null;
  images: StoredImage[];
  updatedAt: number;
}