const SHEETS_WINDOW_MS = 60_000;
const SHEETS_MAX_PER_WINDOW = 50;

const _sheetsTimestamps = [];
let _sheetsQueue = Promise.resolve();

function _isSheetsUrl(url) {
  return String(url).includes('sheets.googleapis.com');
}

async function _waitForSheetsSlot() {
  const now = Date.now();
  while (_sheetsTimestamps.length && _sheetsTimestamps[0] <= now - SHEETS_WINDOW_MS) {
    _sheetsTimestamps.shift();
  }
  if (_sheetsTimestamps.length < SHEETS_MAX_PER_WINDOW) {
    _sheetsTimestamps.push(Date.now());
    return;
  }
  const wait = _sheetsTimestamps[0] + SHEETS_WINDOW_MS - now + 100;
  await new Promise((r) => setTimeout(r, Math.max(wait, 250)));
  return _waitForSheetsSlot();
}

async function _fetchOnce(url, options) {
  if (_isSheetsUrl(url)) {
    return new Promise((resolve, reject) => {
      _sheetsQueue = _sheetsQueue
        .then(() => _waitForSheetsSlot())
        .then(() => fetch(url, options))
        .then(resolve, reject);
    });
  }
  return fetch(url, options);
}

async function fetchWithRetry(
  url,
  options,
  { retries = 2, rateLimitMessage = 'Límite de consultas a Google Sheets alcanzado. Espera 1–2 minutos e intenta de nuevo.' } = {},
) {
  let delay = 5000;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await _fetchOnce(url, options);
    if (res.status !== 429 || attempt === retries) return res;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 60_000);
  }
  throw new Error(rateLimitMessage);
}

module.exports = { fetchWithRetry };