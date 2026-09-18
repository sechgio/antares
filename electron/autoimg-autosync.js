const { operationState } = require('./autoimg-operations');
const { emitError } = require('./autoimg-notify');
const { configValueFromRows } = require('./autoimg-sheet-rows');
const {
  AUTO_SYNC_CONFIG_KEY,
  parseAutoSyncConfig,
  tryUpsertConfigValues,
} = require('./autoimg-sheet-config');

const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;

// El timer llama a `tick` (syncFromSheet) solo cuando no hay operación activa.
// El engine inyecta el tick para evitar un ciclo engine↔autosync.
function createAutoSync({ tick }) {
  let enabled = false;
  let timer = null;

  function applyTimer(next) {
    next = Boolean(next);
    if (next === enabled && (!next || timer)) return;
    enabled = next;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (!enabled) return;
    timer = setInterval(() => {
      if (operationState.active) return;
      tick().catch((err) => {
        emitError('AUTO_SYNC', err.message);
      });
    }, AUTO_SYNC_INTERVAL_MS);
  }

  function cleanup() {
    applyTimer(false);
  }

  function restoreFromConfig(configRows) {
    const value = configValueFromRows(configRows, AUTO_SYNC_CONFIG_KEY);
    if (!value) return;
    applyTimer(parseAutoSyncConfig(value));
  }

  async function setEnabled(next) {
    applyTimer(next);
    const persistence = await tryUpsertConfigValues({ [AUTO_SYNC_CONFIG_KEY]: next ? 'true' : 'false' });
    return { enabled, ...persistence };
  }

  return {
    applyTimer,
    restoreFromConfig,
    setEnabled,
    cleanup,
    isEnabled: () => enabled,
  };
}

module.exports = { createAutoSync };
