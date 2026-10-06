import { atom, fetchJson, httpsUrl, openExternal, timeoutSignal, useValue } from '../radio/core';
import type { Atom } from '../radio/core';

export { atom, fetchJson, httpsUrl, openExternal, timeoutSignal, useValue };
export type { Atom };

/* Una fuente devuelve ítems navegables/buscables; resolve() convierte el ítem
   elegido en la cola de pistas reproducibles (Jamendo: la propia lista;
   Archive: los archivos del ítem). */
export interface StreamItem {
  id: string;
  title: string;
  artist: string;
  duration: number;
}

export interface StreamTrack extends StreamItem {
  itemId?: string;
  stream: string;
  url: string;
}

export interface StreamResolve<T extends StreamItem = StreamTrack> {
  tracks: T[];
  index: number;
}

export interface StreamSource {
  id: string;
  name: string;
  accent: string;
  strings: {
    browse: string;
    trending: string;
    search: string;
    open: string;
    keyHint?: string;
  };
  keyMissing?: () => boolean;
  listIsQueue?: boolean;
  browse: (signal?: AbortSignal) => Promise<StreamItem[]>;
  search: (query: string, signal?: AbortSignal) => Promise<StreamItem[]>;
  resolve: (
    item: StreamItem,
    list: readonly StreamItem[],
    signal?: AbortSignal,
  ) => Promise<StreamResolve>;
}
