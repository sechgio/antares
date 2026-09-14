import { useCallback, useRef, useState } from 'react';

export function useOperationCoordinator() {
  const [busy, setBusy] = useState(false);
  const activeOperationsRef = useRef(0);

  const runOperation = useCallback(async <T>(operation: () => Promise<T>): Promise<T> => {
    activeOperationsRef.current += 1;
    setBusy(true);
    try {
      return await operation();
    } finally {
      activeOperationsRef.current = Math.max(0, activeOperationsRef.current - 1);
      if (activeOperationsRef.current === 0) setBusy(false);
    }
  }, []);

  return { busy, runOperation };
}
