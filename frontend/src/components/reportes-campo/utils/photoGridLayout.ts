export type PhotoGridCell = number | null;

export type PhotoImageSizing = 'aspectPreserve' | 'fill';

export interface PhotoGridLayout {
    columns: number;
    rows: PhotoGridCell[][];
    imageSizing: PhotoImageSizing;
}

const MAX_PHOTOS = 6;

const ASPECT_PRESERVE: PhotoImageSizing = 'aspectPreserve';
const FILL: PhotoImageSizing = 'fill';

export function getPhotoGridLayout(imageCount: number): PhotoGridLayout {
    const count = Math.max(0, Math.min(imageCount, MAX_PHOTOS));

    switch (count) {
        case 0:
            return {
                columns: 3,
                rows: [
                    [null, null, null],
                    [null, null, null],
                ],
                imageSizing: FILL,
            };
        case 1:
            return { columns: 2, rows: [[0]], imageSizing: ASPECT_PRESERVE };
        case 2:
            return { columns: 2, rows: [[0, 1]], imageSizing: ASPECT_PRESERVE };
        case 3:
            return { columns: 2, rows: [[0, 1], [2]], imageSizing: ASPECT_PRESERVE };
        case 4:
            return { columns: 2, rows: [[0, 1], [2, 3]], imageSizing: ASPECT_PRESERVE };
        case 5:
            return { columns: 3, rows: [[0, 1, 2], [3, 4]], imageSizing: FILL };
        default:
            return { columns: 3, rows: [[0, 1, 2], [3, 4, 5]], imageSizing: FILL };
    }
}

export function photoGridCellWidth(columns: number, gapMm = 2): string {
    const totalGap = (columns - 1) * gapMm;
    return `calc((100% - ${totalGap}mm) / ${columns})`;
}
