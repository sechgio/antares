/**
 * Drive verify (single-page) + streaming listFolder/scanNis.
 */
function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

const sheetsPath = require.resolve('../electron/google-sheets-service');
const drivePath = require.resolve('../electron/google-drive-service');
const nisPath = require.resolve('../electron/autoimg-nis');

delete require.cache[sheetsPath];
delete require.cache[drivePath];
delete require.cache[nisPath];

const sheets = require('../electron/google-sheets-service');
sheets.getValidTokens = async () => ({ access_token: 'tok', refresh_token: 'r' });

const drive = require('../electron/google-drive-service');
const { accumulateNisFiles, finalizeNisMap, buildNisMap } = require('../electron/autoimg-nis');

const FOLDER_ID = '1AbCdEfGhIjKlMnOpQrSt';
const originalFetch = global.fetch;

let listCalls = 0;
let metaCalls = 0;

async function main() {
  // --- accumulate / finalize parity with buildNisMap ---
  const files = [
    { id: 'a', name: '6553447_1.jpg', modifiedTime: 't1' },
    { id: 'b', name: '6553447-2.jpeg', modifiedTime: 't2' },
    { id: 'c', name: '9999999_1.jpg', modifiedTime: 't3' },
  ];
  const streamed = {};
  accumulateNisFiles(streamed, files.slice(0, 2), 'A');
  accumulateNisFiles(streamed, files.slice(2), 'A');
  finalizeNisMap(streamed);
  const batched = buildNisMap(files, 'A');
  assert(streamed['6553447'].count === batched['6553447'].count, 'stream count matches batch');
  assert(streamed['6553447'].slots.join(',') === batched['6553447'].slots.join(','), 'stream slots match');
  assert(streamed['9999999'].count === 1, 'second page NIS present');

  // --- verifyFolder: one meta + one list page, no full pagination ---
  listCalls = 0;
  metaCalls = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes(`/drive/v3/files/${FOLDER_ID}?`)) {
      metaCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: FOLDER_ID,
            name: 'Fotos',
            mimeType: 'application/vnd.google-apps.folder',
          }),
      };
    }
    if (u.includes('/drive/v3/files?') && u.includes('pageSize=200')) {
      listCalls += 1;
      const decoded = decodeURIComponent(u);
      assert(decoded.includes('files(name)'), 'verify fields should request name only');
      assert(!u.includes('pageToken='), 'verify must not paginate');
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            nextPageToken: 'MORE',
            files: Array.from({ length: 200 }, (_, i) => ({ name: `f${i}.jpg` })),
          }),
      };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };

  const verified = await drive.verifyFolder(FOLDER_ID);
  assert(metaCalls === 1, 'verify: one meta call');
  assert(listCalls === 1, 'verify: single list page (no full folder walk)');
  assert(verified.accessible === true, 'verify accessible');
  assert(verified.image_count === 200, 'verify lower-bound count from first page');
  assert(verified.has_more === true, 'verify has_more when nextPageToken present');
  assert(verified.sample_files.length === 5, 'verify sample_files capped at 5');
  assert(verified.sample_files[0] === 'f0.jpg', 'verify sample starts at first file');

  // Small folder: exact count, has_more false
  listCalls = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes(`/drive/v3/files/${FOLDER_ID}?`)) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: FOLDER_ID,
            name: 'Chica',
            mimeType: 'application/vnd.google-apps.folder',
          }),
      };
    }
    if (u.includes('/drive/v3/files?')) {
      listCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            files: [{ name: 'a.jpg' }, { name: 'b.jpg' }],
          }),
      };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  const small = await drive.verifyFolder(FOLDER_ID);
  assert(small.image_count === 2 && small.has_more === false, 'small folder exact count');
  assert(listCalls === 1, 'small folder still one list call');

  // --- listFolder collect:false streams pages without returning full array ---
  listCalls = 0;
  const seenPages = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/drive/v3/files?')) {
      listCalls += 1;
      if (!u.includes('pageToken=')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              nextPageToken: 'p2',
              files: [
                { id: '1', name: '1111111_1.jpg', modifiedTime: 't' },
                { id: '2', name: '1111111_2.jpg', modifiedTime: 't' },
              ],
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            files: [{ id: '3', name: '2222222_1.jpg', modifiedTime: 't' }],
          }),
      };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };

  const returned = await drive.listFolder(FOLDER_ID, {
    collect: false,
    onPage: ({ pageFiles, totalSoFar, hasMore }) => {
      seenPages.push({ n: pageFiles.length, totalSoFar, hasMore });
    },
  });
  assert(Array.isArray(returned) && returned.length === 0, 'collect:false returns empty array');
  assert(listCalls === 2, 'listFolder walks all pages for scan');
  assert(seenPages.length === 2, 'onPage called per page');
  assert(seenPages[0].hasMore === true && seenPages[1].hasMore === false, 'hasMore flags');
  assert(seenPages[1].totalSoFar === 3, 'totalSoFar accumulates');

  // --- scanNis streams and builds same map ---
  listCalls = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/drive/v3/files?')) {
      listCalls += 1;
      if (!u.includes('pageToken=')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              nextPageToken: 'p2',
              files: [
                { id: '1', name: '6553447_1.jpg', modifiedTime: 't' },
                { id: '2', name: '6553447_2.jpg', modifiedTime: 't' },
              ],
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            files: [{ id: '3', name: '6553447_3.jpg', modifiedTime: 't' }],
          }),
      };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  const { nis_map } = await drive.scanNis(FOLDER_ID, 'Carpeta');
  assert(listCalls === 2, 'scanNis paginates');
  assert(nis_map['6553447']?.count === 3, 'scanNis aggregates across pages');
  assert(Array.isArray(nis_map['6553447'].slots), 'slots serialized for IPC');
  assert(nis_map['6553447'].folders.includes('Carpeta'), 'folder name recorded');

  global.fetch = originalFetch;
  console.log('[PASS] Drive verify single-page + streaming scanNis');
}

main().catch((err) => {
  global.fetch = originalFetch;
  console.error('[FAIL]', err);
  process.exit(1);
});
