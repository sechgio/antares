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

function validateClientId(clientId) {
  if (!clientId) return;
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    throw new Error(
      'Client ID inválido. Debe ser de tipo "Aplicación de escritorio" en Google Cloud y terminar en .apps.googleusercontent.com',
    );
  }
}

function sanitizeErrorMessage(message) {
  const text = String(message || '');
  if (/429|RESOURCE_EXHAUSTED|Quota exceeded/i.test(text)) {
    return 'Límite de consultas a Google Sheets alcanzado. Espera 1–2 minutos e intenta de nuevo.';
  }
  if (/invalid_grant|Token has been expired or revoked|sesión de Google expiró|REAUTH/i.test(text)) {
    return 'La sesión de Google expiró o fue revocada. Vuelve a conectar tu cuenta con "Conectar con Google".';
  }
  if (SENSITIVE_PATTERNS.some((re) => re.test(text))) {
    return 'Error de autenticación o permisos con Google. Revisa credenciales OAuth y el acceso al Sheet.';
  }
  if (text.length > 280) {
    return `${text.slice(0, 280)}…`;
  }
  return text;
}

function sanitizeErrorText(err) {
  return sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
}

function sanitizeError(err) {
  const message = sanitizeErrorText(err);
  const safe = new Error(message);
  if (err instanceof Error && err.code) safe.code = err.code;
  return safe;
}

// co-012: claves credenciales y firmas de tokens de terceros; «next_page_token» queda fuera a propósito.
const CREDENTIAL_KEY_RE = /(secret|password|passwd|credential|authorization|api[-_]?key|bearer|cookie|jwt)/i;
const TOKEN_KEY_RE = /(?:(?:access|refresh|id|auth|session|credential)[_-]?token$|^token$)/i;
const SECRET_VALUE_RE = /(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/i;

function assertNoSecretInObject(obj, path = 'root') {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();
    if (
      CREDENTIAL_KEY_RE.test(keyLower)
      || TOKEN_KEY_RE.test(keyLower)
      || keyLower === 'private_key'
    ) {
      throw new Error(`Respuesta IPC expone dato sensible en ${path}.${key}`);
    }
    if (typeof value === 'string' && value.length > 16) {
      if (value.length > 40 && /ya29\.|1\/\/|GOCSPX-/i.test(value)) {
        throw new Error(`Respuesta IPC parece incluir token en ${path}.${key}`);
      }
      if (SECRET_VALUE_RE.test(value)) {
        throw new Error(`Respuesta IPC parece incluir credencial en ${path}.${key}`);
      }
    }
    if (value && typeof value === 'object') {
      assertNoSecretInObject(value, `${path}.${key}`);
    }
  }
}

module.exports = {
  maskClientId,
  validateClientId,
  sanitizeError,
  sanitizeErrorText,
  sanitizeErrorMessage,
  assertNoSecretInObject,
};
