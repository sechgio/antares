import { useEffect, useRef, useState } from 'react';

export function useLocalStorageState<T>(
  key: string,
  options: {
    parse: (raw: string) => T;
    fallback: T;
    serialize?: (value: T) => string | null;
  },
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const { parse, fallback, serialize = (v: T) => JSON.stringify(v) } = options;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : parse(raw);
    } catch {
      return fallback;
    }
  });
  const serializeRef = useRef(serialize);
  serializeRef.current = serialize;

  useEffect(() => {
    try {
      const serialized = serializeRef.current(value);
      if (serialized === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, serialized);
      }
    } catch {
    }
  }, [key, value]);

  return [value, setValue];
}
