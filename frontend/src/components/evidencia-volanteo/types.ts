import type { ImageAsset } from '../../types/imageAssets';

export type LocalImage = ImageAsset;
export type LogoAsset = ImageAsset;

export interface CuadranteRange {
  id: string;
  fromPage: number;
  toPage: number;
  cuadrante: string;
}

export interface EvidenciaSession {
  title: string;
  cuadranteLabel: string;
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
