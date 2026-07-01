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
  cuadranteRanges?: CuadranteRange[];
  logoLeft: StoredLogo | null;
  logoRight: StoredLogo | null;
  images: StoredImage[];
  updatedAt: number;
}