import { useRef } from 'react';

// Ref espejo de un valor de estado: se resincroniza en cada render para que
// callbacks estables lean siempre el valor fresco. La asignación dentro del
// hook es el único escritor permitido — escribir ref.current fuera rompe la
// derivación estado → ref.
export function useLiveRef<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
