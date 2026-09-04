import { DEFAULT_BRAND, DEFAULT_ENCABEZADOS, DEFAULT_FOOTER, DEFAULT_HEADING } from "../constants";
import type {
  BrandConfig,
  BulletStyle,
  FooterConfig,
  FlyerEncabezados,
  FlyerHeading,
  FlyerRecord,
  LayoutMode,
  StoredVolantesDraft,
  VolantesDraft,
} from "../types";

export const VOLANTES_DRAFT_STORAGE_KEY = "antares:volantes:draft";

const DB_NAME = "antares_volantes";
const DB_VERSION = 1;
const STORE_NAME = "drafts";
const CURRENT_DRAFT_KEY = "current";

const NUMBER_FIELDS = [
  "titleSize2up",
  "titleSize3up",
  "districtSize2up",
  "districtSize3up",
  "headingsSize2up",
  "headingsSize3up",
  "serviceSize2up",
  "serviceSize3up",
  "reservoirSize2up",
  "reservoirSize3up",
  "sectorSize2up",
  "sectorSize3up",
  "zonesFontSize2up",
  "zonesFontSize3up",
] as const;

const BULLET_STYLES = new Set<BulletStyle>([
  "none",
  "disc",
  "dash",
  "arrow",
  "check",
  "number",
]);

let writeChain: Promise<void> = Promise.resolve();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown> | null,
  key: string,
  fallback: string,
): string {
  const value = record?.[key];
  return typeof value === "string" ? value : fallback;
}

function readNullableString(
  record: Record<string, unknown> | null,
  key: string,
  fallback: string | null,
): string | null {
  const value = record?.[key];
  if (value === null || typeof value === "string") return value;
  return fallback;
}

function isBulletStyle(value: unknown): value is BulletStyle {
  return typeof value === "string" && BULLET_STYLES.has(value as BulletStyle);
}

function normalizeRecord(value: unknown): FlyerRecord | null {
  const record = asRecord(value);
  const requiredFields = [
    "id",
    "distrito",
    "fecha",
    "horaInicio",
    "horaFin",
    "reservorio",
    "sector",
    "zonasAfectadas",
  ] as const;

  if (!record || !requiredFields.every((key) => typeof record[key] === "string")) {
    return null;
  }

  const normalized: FlyerRecord = {
    id: record.id as string,
    distrito: record.distrito as string,
    fecha: record.fecha as string,
    horaInicio: record.horaInicio as string,
    horaFin: record.horaFin as string,
    reservorio: record.reservorio as string,
    sector: record.sector as string,
    zonasAfectadas: record.zonasAfectadas as string,
  };

  if (isBulletStyle(record.bulletStyle)) normalized.bulletStyle = record.bulletStyle;
  if (typeof record.districtColor === "string") normalized.districtColor = record.districtColor;

  for (const key of NUMBER_FIELDS) {
    const numberValue = record[key];
    if (typeof numberValue === "number" && Number.isFinite(numberValue)) {
      normalized[key] = numberValue;
    }
  }

  return normalized;
}

function normalizeBrand(value: unknown): BrandConfig {
  const brand = asRecord(value);
  return {
    logoIzquierdo: readNullableString(brand, "logoIzquierdo", DEFAULT_BRAND.logoIzquierdo),
    logoDerecho: readNullableString(brand, "logoDerecho", DEFAULT_BRAND.logoDerecho),
  };
}

function normalizeFooter(value: unknown): FooterConfig {
  const footer = asRecord(value);
  return {
    logoOperativo: readNullableString(footer, "logoOperativo", DEFAULT_FOOTER.logoOperativo),
    servicioAgua: readNullableString(footer, "servicioAgua", DEFAULT_FOOTER.servicioAgua),
  };
}

function normalizeHeading(value: unknown): FlyerHeading {
  const heading = asRecord(value);
  return {
    titulo: readString(heading, "titulo", DEFAULT_HEADING.titulo),
    subtitulo: readString(heading, "subtitulo", DEFAULT_HEADING.subtitulo),
  };
}

function normalizeEncabezados(value: unknown): FlyerEncabezados {
  const encabezados = asRecord(value);
  return {
    limpiezaReservorios: readString(
      encabezados,
      "limpiezaReservorios",
      DEFAULT_ENCABEZADOS.limpiezaReservorios,
    ),
    zonasAfectadas: readString(
      encabezados,
      "zonasAfectadas",
      DEFAULT_ENCABEZADOS.zonasAfectadas,
    ),
    detalleZonas: readString(
      encabezados,
      "detalleZonas",
      DEFAULT_ENCABEZADOS.detalleZonas,
    ),
  };
}

export function draftToStored(
  draft: VolantesDraft,
  updatedAt = Date.now(),
): StoredVolantesDraft {
  return {
    version: 1,
    updatedAt,
    records: draft.records.map((record) => ({ ...record })),
    brand: { ...draft.brand },
    footer: { ...draft.footer },
    heading: { ...draft.heading },
    encabezados: { ...draft.encabezados },
    layoutMode: draft.layoutMode,
    selectedRecordId: draft.selectedRecordId,
  };
}

export function normalizeStoredDraft(value: unknown): StoredVolantesDraft | null {
  const stored = asRecord(value);
  if (!stored || stored.version !== 1 || !Array.isArray(stored.records)) return null;

  const records = stored.records
    .map(normalizeRecord)
    .filter((record): record is FlyerRecord => record !== null);
  const layoutMode: LayoutMode = stored.layoutMode === "3-up" ? "3-up" : "2-up";
  const selectedRecordId =
    stored.selectedRecordId === null || typeof stored.selectedRecordId === "string"
      ? stored.selectedRecordId
      : null;

  return {
    version: 1,
    updatedAt:
      typeof stored.updatedAt === "number" && Number.isFinite(stored.updatedAt)
        ? stored.updatedAt
        : 0,
    records,
    brand: normalizeBrand(stored.brand),
    footer: normalizeFooter(stored.footer),
    heading: normalizeHeading(stored.heading),
    encabezados: normalizeEncabezados(stored.encabezados),
    layoutMode,
    selectedRecordId,
  };
}

function storedToDraft(stored: StoredVolantesDraft): VolantesDraft {
  return {
    records: stored.records.map((record) => ({ ...record })),
    brand: { ...stored.brand },
    footer: { ...stored.footer },
    heading: { ...stored.heading },
    encabezados: { ...stored.encabezados },
    layoutMode: stored.layoutMode,
    selectedRecordId: stored.selectedRecordId,
  };
}

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function isLocalStorageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readFallbackDraft(): StoredVolantesDraft | null {
  if (!isLocalStorageAvailable()) return null;
  try {
    const raw = localStorage.getItem(VOLANTES_DRAFT_STORAGE_KEY);
    return raw ? normalizeStoredDraft(JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeFallbackDraft(stored: StoredVolantesDraft): void {
  if (!isLocalStorageAvailable()) {
    throw new Error("La persistencia local no está disponible.");
  }
  localStorage.setItem(VOLANTES_DRAFT_STORAGE_KEY, JSON.stringify(stored));
}

function enqueueWrite(operation: () => Promise<void>): Promise<void> {
  writeChain = writeChain.then(operation, operation);
  return writeChain;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIndexedDbDraft(): Promise<StoredVolantesDraft | null> {
  await writeChain.catch(() => undefined);
  const db = await openDb();
  return new Promise<StoredVolantesDraft | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(CURRENT_DRAFT_KEY);
    request.onsuccess = () => {
      const stored = normalizeStoredDraft(request.result as unknown);
      db.close();
      resolve(stored);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function writeIndexedDbDraft(stored: StoredVolantesDraft): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(stored, CURRENT_DRAFT_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function deleteIndexedDbDraft(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(CURRENT_DRAFT_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function pickLatestDraft(
  indexedDraft: StoredVolantesDraft | null,
  fallbackDraft: StoredVolantesDraft | null,
): StoredVolantesDraft | null {
  if (!indexedDraft) return fallbackDraft;
  if (!fallbackDraft) return indexedDraft;
  return indexedDraft.updatedAt >= fallbackDraft.updatedAt ? indexedDraft : fallbackDraft;
}

export async function loadVolantesDraft(): Promise<VolantesDraft | null> {
  await writeChain.catch(() => undefined);
  const fallbackDraft = readFallbackDraft();
  let indexedDraft: StoredVolantesDraft | null = null;

  if (isIndexedDbAvailable()) {
    try {
      indexedDraft = await readIndexedDbDraft();
    } catch {
      indexedDraft = null;
    }
  }

  const stored = pickLatestDraft(indexedDraft, fallbackDraft);
  return stored ? storedToDraft(stored) : null;
}

export function saveVolantesDraft(draft: VolantesDraft): Promise<void> {
  const stored = draftToStored(draft);

  return enqueueWrite(async () => {
    if (isIndexedDbAvailable()) {
      try {
        await writeIndexedDbDraft(stored);
        return;
      } catch (error) {
        if (!isLocalStorageAvailable()) throw error;
      }
    }

    writeFallbackDraft(stored);
  });
}

export function clearVolantesDraft(): Promise<void> {
  return enqueueWrite(async () => {
    let firstError: unknown = null;

    if (isIndexedDbAvailable()) {
      try {
        await deleteIndexedDbDraft();
      } catch (error) {
        firstError = error;
      }
    }

    if (isLocalStorageAvailable()) {
      try {
        localStorage.removeItem(VOLANTES_DRAFT_STORAGE_KEY);
      } catch (error) {
        firstError ??= error;
      }
    }

    if (firstError) {
      throw firstError instanceof Error
        ? firstError
        : new Error("No se pudo limpiar la persistencia local.");
    }
  });
}
