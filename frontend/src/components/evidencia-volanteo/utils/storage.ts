import type { EvidenciaSession, LocalImage, LogoAsset, StoredImage, StoredLogo, StoredSession } from '../types';
import { migrateLegacyCuadrante } from './cuadranteRanges';

export function isPersistenceAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

const DB_NAME = 'antares_evidencia_volanteo';
const DB_VERSION = 1;
const STORE = 'sessions';
const SESSION_KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function logoToStored(logo: LogoAsset): StoredLogo {
  return { name: logo.file.name, type: logo.file.type, blob: logo.file };
}

function storedToLogo(stored: StoredLogo): LogoAsset {
  const file = new File([stored.blob], stored.name, { type: stored.type || 'application/octet-stream' });
  return { file, objectUrl: URL.createObjectURL(file) };
}

function imageToStored(image: LocalImage): StoredImage {
  return {
    name: image.file.name,
    type: image.file.type,
    blob: image.file,
    localPath: image.localPath,
  };
}

function storedToImage(stored: StoredImage): LocalImage {
  const file = new File([stored.blob], stored.name, { type: stored.type || 'application/octet-stream' });
  return {
    file,
    objectUrl: URL.createObjectURL(file),
    localPath: stored.localPath,
  };
}

export function sessionToStored(session: EvidenciaSession): StoredSession {
  return {
    title: session.title,
    cuadranteRanges: session.cuadranteRanges,
    logoLeft: session.logoLeft ? logoToStored(session.logoLeft) : null,
    logoRight: session.logoRight ? logoToStored(session.logoRight) : null,
    images: session.images.map(imageToStored),
    updatedAt: session.updatedAt,
  };
}

export function storedToSession(stored: StoredSession): EvidenciaSession {
  return {
    title: stored.title,
    cuadranteRanges: migrateLegacyCuadrante(stored.cuadrante, stored.cuadranteRanges),
    logoLeft: stored.logoLeft ? storedToLogo(stored.logoLeft) : null,
    logoRight: stored.logoRight ? storedToLogo(stored.logoRight) : null,
    images: stored.images.map(storedToImage),
    updatedAt: stored.updatedAt,
  };
}

export async function loadSession(): Promise<StoredSession | null> {
  if (!isPersistenceAvailable()) return null;
  const db = await openDb();
  return new Promise<StoredSession | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(SESSION_KEY);
    request.onsuccess = () => resolve((request.result as StoredSession | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSession(session: EvidenciaSession): Promise<void> {
  if (!isPersistenceAvailable()) return;
  const db = await openDb();
  const stored = sessionToStored({ ...session, updatedAt: Date.now() });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(stored, SESSION_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearStoredSession(): Promise<void> {
  if (!isPersistenceAvailable()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(SESSION_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}