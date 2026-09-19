const fs = require('fs');
const path = require('path');

function createAsyncLogWriter({
  getLogsDir,
  getMaxFileBytes,
  managedLogPattern,
  maxDirectoryBytes,
  onDrop,
  budgetInterval = 200,
  maxPendingEntries = 5_000,
}) {
  let pendingEntries = [];
  let flushScheduled = false;
  let drainPromise = Promise.resolve();
  let budgetCounter = 0;
  const fileSizes = new Map();

  async function safePathFor(filePath) {
    try {
      const stat = await fs.promises.lstat(filePath);
      if (stat.isSymbolicLink()) {
        await fs.promises.unlink(filePath);
        fileSizes.delete(filePath);
      }
    } catch {}
    return filePath;
  }

  function rotatedPath(basePath, index) {
    const extension = path.extname(basePath);
    return `${basePath.slice(0, -extension.length)}.${index}${extension}`;
  }

  async function knownSize(filePath) {
    const cached = fileSizes.get(filePath);
    if (cached !== undefined) return cached;
    try {
      const size = (await fs.promises.stat(filePath)).size;
      fileSizes.set(filePath, size);
      return size;
    } catch {
      fileSizes.set(filePath, 0);
      return 0;
    }
  }

  async function selectPath(basePath, line, projectedSizes) {
    const safeBasePath = await safePathFor(basePath);
    const lineBytes = Buffer.byteLength(line, 'utf8');
    for (let index = 0; index < 1000; index += 1) {
      const rawCandidate = index === 0 ? safeBasePath : rotatedPath(safeBasePath, index);
      const candidate = await safePathFor(rawCandidate);
      const currentSize = projectedSizes.has(candidate)
        ? projectedSizes.get(candidate)
        : await knownSize(candidate);
      if (currentSize + lineBytes <= getMaxFileBytes()) {
        projectedSizes.set(candidate, currentSize + lineBytes);
        return candidate;
      }
    }
    projectedSizes.set(safeBasePath, lineBytes);
    return safeBasePath;
  }

  async function enforceDirectoryBudget() {
    try {
      const names = await fs.promises.readdir(getLogsDir());
      const entries = (await Promise.all(names
        .filter((name) => managedLogPattern.test(name))
        .map(async (name) => {
          const filePath = path.join(getLogsDir(), name);
          const stat = await fs.promises.stat(filePath);
          return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
        }))).sort((a, b) => a.mtimeMs - b.mtimeMs);
      let total = entries.reduce((sum, entry) => sum + entry.size, 0);
      for (const entry of entries) {
        if (total <= maxDirectoryBytes) break;
        await fs.promises.unlink(entry.filePath);
        fileSizes.delete(entry.filePath);
        total -= entry.size;
      }
    } catch {}
  }

  async function enforceBudgetThrottled(entryCount) {
    budgetCounter += entryCount;
    if (budgetCounter < budgetInterval) return;
    budgetCounter %= budgetInterval;
    await enforceDirectoryBudget();
  }

  async function writeBatch(entries) {
    if (entries.length === 0) return;
    try {
      await fs.promises.mkdir(getLogsDir(), { recursive: true });
      const projectedSizes = new Map();
      const groups = new Map();
      for (const entry of entries) {
        const target = await selectPath(entry.basePath, entry.line, projectedSizes);
        const group = groups.get(target) || { text: '', entries: [] };
        group.text += entry.line;
        group.entries.push(entry);
        groups.set(target, group);
      }
      for (const [target, group] of groups) {
        try {
          await fs.promises.appendFile(target, group.text, 'utf8');
          fileSizes.set(target, projectedSizes.get(target) || Buffer.byteLength(group.text, 'utf8'));
          for (const entry of group.entries) entry.onSuccess?.();
        } catch {
          fileSizes.delete(target);
          for (const _entry of group.entries) onDrop();
        }
      }
      await enforceBudgetThrottled(entries.length);
    } catch {
      for (const _entry of entries) onDrop();
    }
  }

  function scheduleDrain() {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const entries = pendingEntries;
      pendingEntries = [];
      // El .catch impide que un rechazo envenene la cadena y desactive el logging.
      drainPromise = drainPromise.then(() => writeBatch(entries)).catch(() => {});
    });
  }

  function safePathSync(filePath) {
    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        fs.unlinkSync(filePath);
        fileSizes.delete(filePath);
      }
    } catch {}
    return filePath;
  }

  function knownSizeSync(filePath) {
    const cached = fileSizes.get(filePath);
    if (cached !== undefined) return cached;
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch {}
    fileSizes.set(filePath, size);
    return size;
  }

  function selectPathSync(basePath, lineBytes) {
    const safeBasePath = safePathSync(basePath);
    for (let index = 0; index < 1000; index += 1) {
      const candidate = safePathSync(index === 0 ? safeBasePath : rotatedPath(safeBasePath, index));
      if (knownSizeSync(candidate) + lineBytes <= getMaxFileBytes()) return candidate;
    }
    return safeBasePath;
  }

  // Ultimo recurso en cierre/crash: persiste solo lo aun no capturado por la cola
  // asincrona (los lotes en vuelo se pierden; mejor que perder todo el pending).
  function flushSync() {
    const entries = pendingEntries;
    pendingEntries = [];
    if (entries.length === 0) return;
    try {
      fs.mkdirSync(getLogsDir(), { recursive: true });
    } catch {}
    for (const entry of entries) {
      const lineBytes = Buffer.byteLength(entry.line, 'utf8');
      try {
        const target = selectPathSync(entry.basePath, lineBytes);
        fs.appendFileSync(target, entry.line, 'utf8');
        fileSizes.set(target, (fileSizes.get(target) || 0) + lineBytes);
        entry.onSuccess?.();
      } catch {
        onDrop();
      }
    }
  }

  function append(basePath, line, onSuccess = undefined) {
    if (pendingEntries.length >= maxPendingEntries) {
      onDrop();
      return;
    }
    pendingEntries.push({ basePath, line, onSuccess });
    scheduleDrain();
  }

  async function flush(maxRounds = 100) {
    for (let round = 0; round < maxRounds; round += 1) {
      await Promise.resolve();
      const observedDrain = drainPromise;
      await observedDrain;
      if (drainPromise === observedDrain && !flushScheduled && pendingEntries.length === 0) return;
    }
  }

  return { append, flush, flushSync };
}

module.exports = { createAsyncLogWriter };
