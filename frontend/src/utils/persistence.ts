export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
