/**
 * Evalúa expresiones aritméticas simples en campos numéricos del inspector:
 * "50/2", "10 + 4.5", "(20-5)*2", "1,5" (coma decimal).
 * Devuelve null cuando la entrada no es una expresión válida.
 */
export function evalNumericExpression(raw: string): number | null {
  const text = raw.trim().replaceAll(',', '.');
  if (!text) return null;
  let i = 0;

  function peek() {
    return i < text.length ? text[i] : undefined;
  }

  function skipWs() {
    while (i < text.length && /\s/.test(text[i])) i++;
  }

  function parseFactor(): number | null {
    skipWs();
    let sign = 1;
    while (peek() === '+' || peek() === '-') {
      if (peek() === '-') sign = -sign;
      i++;
      skipWs();
    }
    if (peek() === '(') {
      i++;
      const inner = parseExpr();
      skipWs();
      if (peek() !== ')') return null;
      i++;
      return inner == null ? null : sign * inner;
    }
    const m = /^\d*\.?\d+/.exec(text.slice(i));
    if (!m) return null;
    i += m[0].length;
    return sign * Number(m[0]);
  }

  function parseTerm(): number | null {
    let value = parseFactor();
    if (value == null) return null;
    for (;;) {
      skipWs();
      const op = peek();
      if (op !== '*' && op !== '/' && op !== 'x' && op !== '×') return value;
      i++;
      const rhs = parseFactor();
      if (rhs == null) return null;
      value = op === '/' ? value / rhs : value * rhs;
      if (!Number.isFinite(value)) return null;
    }
  }

  function parseExpr(): number | null {
    let value = parseTerm();
    if (value == null) return null;
    for (;;) {
      skipWs();
      const op = peek();
      if (op !== '+' && op !== '-') return value;
      i++;
      const rhs = parseTerm();
      if (rhs == null) return null;
      value = op === '+' ? value + rhs : value - rhs;
    }
  }

  const result = parseExpr();
  skipWs();
  if (result == null || i !== text.length) return null;
  return Number.isFinite(result) ? result : null;
}
