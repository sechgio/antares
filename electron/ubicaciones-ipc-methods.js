/** Métodos IPC Ubicaciones (allowlist + router). Sin dependencias para evitar ciclos. */
const UBICACIONES_METHODS = new Set([
  'ubicaciones_keys_get',
  'ubicaciones_keys_set',
]);

module.exports = { UBICACIONES_METHODS };
