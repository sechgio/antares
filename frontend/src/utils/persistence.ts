export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function runIdbWrite(
  openDb: () => Promise<IDBDatabase>,
  storeName: string,
  op: (store: IDBObjectStore) => unknown,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    op(tx.objectStore(storeName));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }).finally(() => db.close());
}
