export interface ZipEntry {
  filename: string;
  blob: Blob;
}

const encoder = new TextEncoder();
const ZIP64_LIMIT = 0xffffffff;
const ZIP64_ENTRY_LIMIT = 0xffff;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const VERSION_STORE = 20;
const VERSION_ZIP64 = 45;

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  crcTable = table;
  return table;
}

function updateCrc32(current: number, chunk: Uint8Array): number {
  const table = getCrcTable();
  let crc = current;
  for (let i = 0; i < chunk.length; i += 1) {
    crc = table[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

async function computeCrc32(blob: Blob): Promise<number> {
  let crc = 0xffffffff;
  const stream = (blob as Blob & { stream?: () => ReadableStream<Uint8Array> }).stream;
  if (typeof stream === 'function') {
    const reader = stream.call(blob).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          crc = updateCrc32(crc, value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    crc = updateCrc32(crc, new Uint8Array(await blob.arrayBuffer()));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { date: dosDate, time: dosTime };
}

function writeUint64(view: DataView, offset: number, value: number): void {
  view.setBigUint64(offset, BigInt(value), true);
}

function zip64ExtraField(values: number[]): Uint8Array {
  const bytes = new Uint8Array(4 + values.length * 8);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x0001, true);
  view.setUint16(2, values.length * 8, true);
  values.forEach((value, index) => writeUint64(view, 4 + index * 8, value));
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function safeArchiveSegment(value: string, fallback: string): string {
  const safe = value.trim().replace(/\\/g, '/').split('/').pop()?.trim() || fallback;
  return safe.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
}

function safeFolderName(zipFilename: string): string {
  const safe = safeArchiveSegment(zipFilename, 'imagenes_optimizadas').replace(/\s+/g, '_');
  const withoutExtension = safe.toLowerCase().endsWith('.zip') ? safe.slice(0, -4) : safe;
  return withoutExtension || 'imagenes_optimizadas';
}

function dedupeArchiveName(filename: string, seen: Map<string, number>): string {
  const key = filename.toLowerCase();
  const count = seen.get(key) ?? 0;
  seen.set(key, count + 1);
  if (count === 0) return filename;

  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) return `${filename}-${count + 1}`;
  return `${filename.slice(0, dotIndex)}-${count + 1}${filename.slice(dotIndex)}`;
}

function localFileHeader(nameBytes: Uint8Array, crc: number, size: number, date: number, time: number): Uint8Array {
  const needsZip64 = size > ZIP64_LIMIT;
  const extra = needsZip64 ? zip64ExtraField([size, size]) : new Uint8Array();
  const bytes = new Uint8Array(30 + nameBytes.length + extra.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, needsZip64 ? VERSION_ZIP64 : VERSION_STORE, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, STORE_METHOD, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, needsZip64 ? ZIP64_LIMIT : size, true);
  view.setUint32(22, needsZip64 ? ZIP64_LIMIT : size, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, extra.length, true);
  bytes.set(nameBytes, 30);
  bytes.set(extra, 30 + nameBytes.length);
  return bytes;
}

function centralDirectoryHeader(
  nameBytes: Uint8Array,
  crc: number,
  size: number,
  localOffset: number,
  date: number,
  time: number,
): Uint8Array {
  const sizeNeedsZip64 = size > ZIP64_LIMIT;
  const offsetNeedsZip64 = localOffset > ZIP64_LIMIT;
  const extraValues = [
    ...(sizeNeedsZip64 ? [size, size] : []),
    ...(offsetNeedsZip64 ? [localOffset] : []),
  ];
  const extra = extraValues.length > 0 ? zip64ExtraField(extraValues) : new Uint8Array();
  const bytes = new Uint8Array(46 + nameBytes.length + extra.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 0x031e, true);
  view.setUint16(6, extraValues.length > 0 ? VERSION_ZIP64 : VERSION_STORE, true);
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, STORE_METHOD, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, sizeNeedsZip64 ? ZIP64_LIMIT : size, true);
  view.setUint32(24, sizeNeedsZip64 ? ZIP64_LIMIT : size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, extra.length, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offsetNeedsZip64 ? ZIP64_LIMIT : localOffset, true);
  bytes.set(nameBytes, 46);
  bytes.set(extra, 46 + nameBytes.length);
  return bytes;
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Uint8Array[] {
  const needsZip64 =
    entryCount > ZIP64_ENTRY_LIMIT ||
    centralSize > ZIP64_LIMIT ||
    centralOffset > ZIP64_LIMIT;
  const parts: Uint8Array[] = [];

  if (needsZip64) {
    const zip64EndOffset = centralOffset + centralSize;
    const zip64End = new Uint8Array(56);
    const zip64View = new DataView(zip64End.buffer);
    zip64View.setUint32(0, 0x06064b50, true);
    writeUint64(zip64View, 4, 44);
    zip64View.setUint16(12, VERSION_ZIP64, true);
    zip64View.setUint16(14, VERSION_ZIP64, true);
    zip64View.setUint32(16, 0, true);
    zip64View.setUint32(20, 0, true);
    writeUint64(zip64View, 24, entryCount);
    writeUint64(zip64View, 32, entryCount);
    writeUint64(zip64View, 40, centralSize);
    writeUint64(zip64View, 48, centralOffset);
    parts.push(zip64End);

    const locator = new Uint8Array(20);
    const locatorView = new DataView(locator.buffer);
    locatorView.setUint32(0, 0x07064b50, true);
    locatorView.setUint32(4, 0, true);
    writeUint64(locatorView, 8, zip64EndOffset);
    locatorView.setUint32(16, 1, true);
    parts.push(locator);
  }

  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, needsZip64 ? ZIP64_ENTRY_LIMIT : entryCount, true);
  view.setUint16(10, needsZip64 ? ZIP64_ENTRY_LIMIT : entryCount, true);
  view.setUint32(12, needsZip64 ? ZIP64_LIMIT : centralSize, true);
  view.setUint32(16, needsZip64 ? ZIP64_LIMIT : centralOffset, true);
  view.setUint16(20, 0, true);
  parts.push(end);
  return parts;
}

export async function createStoredZipBlob(entries: ZipEntry[], zipFilename: string): Promise<Blob> {
  if (entries.length === 0) {
    throw new Error('No hay archivos para comprimir');
  }

  const folder = safeFolderName(zipFilename);
  const { date, time } = dosDateTime();
  const outputParts: BlobPart[] = [];
  const centralParts: Uint8Array[] = [];
  const seenNames = new Map<string, number>();
  let offset = 0;

  for (const entry of entries) {
    const entryName = dedupeArchiveName(safeArchiveSegment(entry.filename, 'archivo'), seenNames);
    const archiveName = `${folder}/${entryName}`;
    const nameBytes = encoder.encode(archiveName);
    const crc = await computeCrc32(entry.blob);
    const localHeader = localFileHeader(nameBytes, crc, entry.blob.size, date, time);
    const centralHeader = centralDirectoryHeader(nameBytes, crc, entry.blob.size, offset, date, time);

    outputParts.push(asArrayBuffer(localHeader), entry.blob);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.blob.size;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  outputParts.push(
    ...centralParts.map(asArrayBuffer),
    ...endOfCentralDirectory(entries.length, centralSize, centralOffset).map(asArrayBuffer),
  );
  return new Blob(outputParts, { type: 'application/zip' });
}
