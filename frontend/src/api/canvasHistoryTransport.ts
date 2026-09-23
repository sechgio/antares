import type { HistoryStep } from '../components/canvas/utils/canvasDiff';

type HistoryResponse = { success: boolean; digest?: string };
type HistoryInvoke = (params: Record<string, unknown>) => Promise<HistoryResponse>;
type HistoryTransportState = {
  past: HistoryStep[];
  future: HistoryStep[];
  digest: string;
};

const transportState = new Map<string, HistoryTransportState>();
const saveQueues = new Map<string, Promise<HistoryResponse>>();
const MAX_CACHED_DOCUMENTS = 2;

export function forgetCanvasHistoryTransport(id: string): void {
  transportState.delete(id);
}

export function resetCanvasHistoryTransportForTests(): void {
  transportState.clear();
  saveQueues.clear();
}

function commonPrefix(previous: HistoryStep[], next: HistoryStep[]): number {
  const limit = Math.min(previous.length, next.length);
  let index = 0;
  while (index < limit && previous[index] === next[index]) index += 1;
  return index;
}

export function saveCanvasHistoryIncrementally(
  invoke: HistoryInvoke,
  id: string,
  past: HistoryStep[],
  future: HistoryStep[],
): Promise<HistoryResponse> {
  const execute = async (): Promise<HistoryResponse> => {
    const previous = transportState.get(id);
    if (previous) {
      transportState.delete(id);
      transportState.set(id, previous);
    }
    const fullPayload = { id, past, future, include_digest: true };
    let response: HistoryResponse;
    if (!previous?.digest) {
      response = await invoke(fullPayload);
    } else {
      const pastPrefix = commonPrefix(previous.past, past);
      const futurePrefix = commonPrefix(previous.future, future);
      try {
        response = await invoke({
          id,
          past_prefix: pastPrefix,
          past: past.slice(pastPrefix),
          future_prefix: futurePrefix,
          future: future.slice(futurePrefix),
          base_digest: previous.digest,
        });
      } catch {
        transportState.delete(id);
        response = await invoke(fullPayload);
      }
    }
    if (response.digest) {
      transportState.delete(id);
      transportState.set(id, {
        past: past.slice(),
        future: future.slice(),
        digest: response.digest,
      });
      if (transportState.size > MAX_CACHED_DOCUMENTS) {
        transportState.delete(transportState.keys().next().value!);
      }
    } else {
      transportState.delete(id);
    }
    return response;
  };

  const previousSave = saveQueues.get(id) ?? Promise.resolve({ success: true });
  const currentSave = previousSave.catch(() => ({ success: false })).then(execute);
  saveQueues.set(id, currentSave);
  void currentSave.then(
    () => {
      if (saveQueues.get(id) === currentSave) saveQueues.delete(id);
    },
    () => {
      if (saveQueues.get(id) === currentSave) saveQueues.delete(id);
    },
  );
  return currentSave;
}
