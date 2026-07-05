const SENSITIVE_PATTERNS = [
  /client_secret/i,
  /refresh_token/i,
  /access_token/i,
  /"private_key"/i,
];

function maskClientId(clientId) {
  const id = String(clientId || '');
  if (id.length <= 16) return '••••••••';
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function sanitizeErrorMessage(message) {
  const text = String(message || '');
  if (/429|RESOURCE_EXHAUSTED|Quota exceeded/i.test(text)) {
    return 'Límite de consultas a Google Sheets alcanzado. Espera 1–2 minutos e intenta de nuevo.';
  }
  if (SENSITIVE_PATTERNS.some((re) => re.test(text))) {
    return 'Error de autenticación o permisos con Google. Revisa credenciales OAuth y el acceso al Sheet.';
  }
  if (text.length > 280) {
    return `${text.slice(0, 280)}…`;
  }
  return text;
}

function sanitizeError(err) {
  const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
  const safe = new Error(message);
  if (err instanceof Error && err.code) safe.code = err.code;
  return safe;
}

function assertNoSecretInObject(obj, path = 'root') {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();
    if (keyLower.includes('secret') || keyLower === 'refresh_token' || keyLower === 'access_token') {
      throw new Error(`Respuesta IPC expone dato sensible en ${path}.${key}`);
    }
    if (value && typeof value === 'object') {
      assertNoSecretInObject(value, `${path}.${key}`);
    }
  }
}

module.exports = {
  maskClientId,
  sanitizeError,
  sanitizeErrorMessage,
  assertNoSecretInObject,
};