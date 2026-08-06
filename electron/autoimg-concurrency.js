class OperationCancelledError extends Error {
  constructor(message = 'Operación cancelada', partial = null) {
    super(message);
    this.name = 'OperationCancelledError';
    this.partial = partial;
  }
}

async function mapWithConcurrency(items, limit, fn, { shouldCancel } = {}) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;

  const checkCancel = () => {
    if (shouldCancel?.()) throw new OperationCancelledError();
  };

  async function worker() {
    while (true) {
      checkCancel();
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) break;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

module.exports = {
  OperationCancelledError,
  mapWithConcurrency,
};