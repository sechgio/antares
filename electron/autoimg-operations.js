const { appendLogEvent } = require('./app-log');
const { OperationCancelledError } = require('./autoimg-concurrency');
const { emit } = require('./autoimg-notify');

const CANCELLABLE_OPERATIONS = new Set(['scan', 'scan_sync', 'sync_to', 'rename']);

// Estado mutable de la operación en curso, compartido por lock/cancel/status.
const operationState = {
  active: null,
  cancelRequested: false,
};

function throwIfCancelled(partial = null) {
  if (operationState.cancelRequested) {
    throw new OperationCancelledError('Operación cancelada', partial);
  }
}

async function runLocked(operation, fn) {
  if (operationState.active) {
    throw new Error(`Ya hay una operación en curso (${operationState.active}). Espera a que termine.`);
  }
  operationState.active = operation;
  operationState.cancelRequested = false;
  const startedAt = Date.now();
  appendLogEvent('INFO', 'autoimg.operation_start', {
    component: 'electron',
    operation_id: operation,
    message: `AutoIMG operation started: ${operation}`,
  });
  try {
    const res = await fn();
    appendLogEvent('INFO', 'autoimg.operation_end', {
      component: 'electron',
      operation_id: operation,
      outcome: 'success',
      duration_ms: Date.now() - startedAt,
      message: `AutoIMG operation finished: ${operation}`,
    });
    return res;
  } catch (err) {
    if (err instanceof OperationCancelledError || operationState.cancelRequested) {
      const partial = err instanceof OperationCancelledError ? err.partial : null;
      appendLogEvent('WARN', 'autoimg.operation_end', {
        component: 'electron',
        operation_id: operation,
        outcome: 'cancelled',
        duration_ms: Date.now() - startedAt,
        message: `AutoIMG operation cancelled: ${operation}`,
      });
      emit('autoimg.operation.cancelled', { operation, partial: partial || null });
      const detail = partial
        ? `Operación cancelada por el usuario (progreso parcial: ${JSON.stringify(partial)})`
        : 'Operación cancelada por el usuario';
      const cancelErr = new Error(detail);
      cancelErr.code = 'OPERATION_CANCELLED';
      cancelErr.partial = partial || null;
      cancelErr.cancelled = true;
      throw cancelErr;
    }
    appendLogEvent('ERROR', 'autoimg.operation_end', {
      component: 'electron',
      operation_id: operation,
      outcome: 'failed',
      duration_ms: Date.now() - startedAt,
      error_code: err && err.code ? String(err.code) : undefined,
      message: `AutoIMG operation failed: ${operation} - ${err && err.message ? err.message : String(err)}`,
    });
    throw err;
  } finally {
    operationState.active = null;
    operationState.cancelRequested = false;
  }
}

function cancelOperation() {
  if (!operationState.active) return { success: false, reason: 'no_operation' };
  if (!CANCELLABLE_OPERATIONS.has(operationState.active)) {
    return { success: false, reason: 'not_cancellable', operation: operationState.active };
  }
  operationState.cancelRequested = true;
  return { success: true, operation: operationState.active };
}

function getOperationStatus() {
  return {
    active: operationState.active,
    cancellable: CANCELLABLE_OPERATIONS.has(operationState.active),
  };
}

module.exports = {
  operationState,
  throwIfCancelled,
  runLocked,
  cancelOperation,
  getOperationStatus,
};
