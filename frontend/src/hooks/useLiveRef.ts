import { useRef } from 'react';

// Mantiene el valor actual para callbacks estables; solo este hook debe escribir ref.current.
export function useLiveRef<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
