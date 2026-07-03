async function fetchWithRetry(url, options, { retries = 4, rateLimitMessage = 'Rate limit excedido en Google API' } = {}) {
  let delay = 1000;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429 || attempt === retries) return res;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 60_000);
  }
  throw new Error(rateLimitMessage);
}

module.exports = { fetchWithRetry };