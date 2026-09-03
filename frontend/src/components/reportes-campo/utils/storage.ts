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

export function isPersistenceAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
}

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

function enqueueWrite(op: () => Promise<void>): Promise<void> {
    writeChain = writeChain.then(op, op);
    return writeChain;
}

export async function waitForPendingWrites(): Promise<void> {
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
    if (!isPersistenceAvailable()) return [];
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
    });
}

export async function savePanel(stored: StoredPanel): Promise<void> {
    if (!isPersistenceAvailable()) return;
    return enqueueWrite(async () => {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(stored);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    });
}

export async function deleteStoredPanel(id: string): Promise<void> {
    if (!isPersistenceAvailable()) return;
    return enqueueWrite(async () => {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    });
}

export async function loadBranding(reportType: ReportType): Promise<StoredBranding | null> {
    if (!isPersistenceAvailable()) return null;
    await waitForPendingWrites();
    const db = await openDb();
    return new Promise<StoredBranding | null>((resolve, reject) => {
        const tx = db.transaction(BRANDING_STORE, 'readonly');
        const request = tx.objectStore(BRANDING_STORE).get(reportType);
        request.onsuccess = () => resolve((request.result as StoredBranding | undefined) ?? null);
        request.onerror = () => reject(request.error);
    });
}

export async function saveBranding(stored: StoredBranding): Promise<void> {
    if (!isPersistenceAvailable()) return;
    return enqueueWrite(async () => {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(BRANDING_STORE, 'readwrite');
            tx.objectStore(BRANDING_STORE).put(stored);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    });
}
