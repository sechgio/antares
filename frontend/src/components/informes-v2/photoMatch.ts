import { matchesRecordId } from '../canvas/runtime/excel';
import type { PhotoAsset } from './types';

export { matchesRecordId };

function photoSortKey(name: string): number {
  const match = name.match(/[-_](\d+)\.[^.]+$/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function naturalSortPhotos(a: PhotoAsset, b: PhotoAsset): number {
  const numA = photoSortKey(a.name);
  const numB = photoSortKey(b.name);
  if (numA !== numB) return numA - numB;
  return a.name.localeCompare(b.name);
}

export function matchPhotosForId(photos: PhotoAsset[], photoId: string, limit = 6): PhotoAsset[] {
  const id = String(photoId || '').trim();
  if (!id) return [];
  const matched = photos.filter((photo) => matchesRecordId(photo.name, id));
  const byName = new Map<string, PhotoAsset>();
  for (const photo of matched) {
    const key = photo.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, photo);
  }
  return [...byName.values()].sort(naturalSortPhotos).slice(0, limit);
}
