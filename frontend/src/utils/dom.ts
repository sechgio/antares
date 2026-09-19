/**
 * True si el target de un evento de teclado es un control editable
 * (input/textarea/select o contentEditable). Acepta objetos duck-typed
 * (los tests pasan `{ tagName: 'INPUT' }`), no exige `instanceof HTMLElement`.
 */
export function isEditableKeyboardTarget(el: EventTarget | null): boolean {
  if (!el || typeof el !== 'object') return false;
  const node = el as HTMLElement;
  const tag = node.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(node.isContentEditable);
}
