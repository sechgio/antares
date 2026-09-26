import type {
    CampoPanel,
    HeaderMap,
    LogoData,
    PhotoFile,
    ReportType,
    StoredBranding,
    StoredPanel,
    StoredPhoto,
} from '../types';
import { reportFrontendError } from '../../../utils/observability';
import { isIndexedDbAvailable, runIdbWrite } from '../../../utils/persistence';
import { errorMessage } from '@/utils/errors';

export function photoFileToStored(photo: PhotoFile): StoredPhoto {
    return {
        id: photo.id,
        name: photo.file.name,
        type: photo.file.type,
        blob: photo.file,
    };
}

export function storedToPhotoFile(stored: StoredPhoto): PhotoFile {
    const file = new File([stored.blob], stored.name, {
        type: stored.type || 'application/octet-stream',
    });
    return {
        id: stored.id,
        file,
        previewUrl: URL.createObjectURL(file),
    };
}

export function logoDataToStored(logo: LogoData, side: 'left' | 'right'): StoredPhoto {
    return {
        id: `logo-${side}`,
        name: logo.file.name,
        type: logo.file.type,
        blob: logo.file,
    };
}

export function storedToLogoData(stored: StoredPhoto): LogoData {
    const file = new File([stored.blob], stored.name, {
        type: stored.type || 'application/octet-stream',
    });
    return {
        file,
        url: URL.createObjectURL(file),
    };
}

export function panelToStored(panel: CampoPanel, reportType: ReportType): StoredPanel {
    return {
        id: panel.id,
        reportType,
        label: panel.label,
        header: { ...panel.header },
        createdAt: panel.createdAt,
        updatedAt: Date.now(),
        photos: panel.photos.map(photoFileToStored),
    };
}

export function storedToPanel(stored: StoredPanel): CampoPanel {
    return {
        id: stored.id,
        label: stored.label,
        header: { ...stored.header } as HeaderMap,
        photos: stored.photos.map(storedToPhotoFile),
        createdAt: stored.createdAt,
    };
}

export function brandingToStored(
    reportType: ReportType,
    logoLeft: LogoData | null,
    logoRight: LogoData | null,
): StoredBranding {
    return {
        reportType,
        logoLeft: logoLeft ? logoDataToStored(logoLeft, 'left') : null,
        logoRight: logoRight ? logoDataToStored(logoRight, 'right') : null,
        updatedAt: Date.now(),
    };
}

export function storedToBrandingLogos(stored: StoredBranding | null): {
    logoLeft: LogoData | null;
    logoRight: LogoData | null;
} {
    if (!stored) return { logoLeft: null, logoRight: null };
    return {
        logoLeft: stored.logoLeft ? storedToLogoData(stored.logoLeft) : null,
        logoRight: stored.logoRight ? storedToLogoData(stored.logoRight) : null,
    };
}

const DB_NAME = 'antares_reportes_campo';
const DB_VERSION = 2;
const STORE = 'panels';
const BRANDING_STORE = 'branding';
const TYPE_INDEX = 'by_type';

let writeChain: Promise<void> = Promise.resolve();

function enqueueWrite(op: () => Promise<void>, opName: string): Promise<void> {
    writeChain = writeChain.then(op, op);
    writeChain.catch((err) => {
        reportFrontendError({
            kind: 'storage_error',
            view: `reportes-campo.${opName}`,
            name: err instanceof Error ? err.name : 'StorageError',
            message: errorMessage(err, String(err)),
        });
    });
    return writeChain;
}

async function waitForPendingWrites(): Promise<void> {
    await writeChain;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id' });
                store.createIndex(TYPE_INDEX, 'reportType', { unique: false });
            }
            if (!db.objectStoreNames.contains(BRANDING_STORE)) {
                db.createObjectStore(BRANDING_STORE, { keyPath: 'reportType' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function loadPanelsByType(reportType: ReportType): Promise<StoredPanel[]> {
    if (!isIndexedDbAvailable()) return [];
    await waitForPendingWrites();
    const db = await openDb();
    return new Promise<StoredPanel[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const index = tx.objectStore(STORE).index(TYPE_INDEX);
        const request = index.getAll(IDBKeyRange.only(reportType));
        request.onsuccess = () => {
            const items = (request.result as StoredPanel[]) ?? [];
            items.sort((a, b) => a.createdAt - b.createdAt);
            resolve(items);
        };
        request.onerror = () => reject(request.error);
    }).finally(() => db.close());
}

export async function savePanel(stored: StoredPanel): Promise<void> {
    if (!isIndexedDbAvailable()) return;
    return enqueueWrite(() => runIdbWrite(openDb, STORE, (os) => os.put(stored)), 'savePanel');
}

export async function deleteStoredPanel(id: string): Promise<void> {
    if (!isIndexedDbAvailable()) return;
    return enqueueWrite(() => runIdbWrite(openDb, STORE, (os) => os.delete(id)), 'deletePanel');
}

export async function loadBranding(reportType: ReportType): Promise<StoredBranding | null> {
    if (!isIndexedDbAvailable()) return null;
    await waitForPendingWrites();
    const db = await openDb();
    return new Promise<StoredBranding | null>((resolve, reject) => {
        const tx = db.transaction(BRANDING_STORE, 'readonly');
        const request = tx.objectStore(BRANDING_STORE).get(reportType);
        request.onsuccess = () => resolve((request.result as StoredBranding | undefined) ?? null);
        request.onerror = () => reject(request.error);
    }).finally(() => db.close());
}

export async function saveBranding(stored: StoredBranding): Promise<void> {
    if (!isIndexedDbAvailable()) return;
    return enqueueWrite(() => runIdbWrite(openDb, BRANDING_STORE, (os) => os.put(stored)), 'saveBranding');
}
