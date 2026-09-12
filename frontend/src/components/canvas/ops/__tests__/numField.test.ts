import { describe, expect, it } from 'vitest';
import { evalNumericExpression } from '../numField';

describe('evalNumericExpression', () => {
  it('evalúa literales y decimales con coma', () => {
    expect(evalNumericExpression('12')).toBe(12);
    expect(evalNumericExpression('12.5')).toBe(12.5);
    expect(evalNumericExpression('1,5')).toBe(1.5);
    expect(evalNumericExpression('1,5 + 2,5')).toBe(4);
    expect(evalNumericExpression('10,5 * 2,0')).toBe(21);
    expect(evalNumericExpression("10\t+\t2")).toBe(12);
    expect(evalNumericExpression(' 42 ')).toBe(42);
  });

  it('respeta la precedencia de operadores', () => {
    expect(evalNumericExpression('10+2*3')).toBe(16);
    expect(evalNumericExpression('50/2')).toBe(25);
    expect(evalNumericExpression('100 - 20 - 5')).toBe(75);
    expect(evalNumericExpression('2*3+4')).toBe(10);
    expect(evalNumericExpression('10x3')).toBe(30);
    expect(evalNumericExpression('5×4')).toBe(20);
  });

  it('soporta paréntesis y signos unarios', () => {
    expect(evalNumericExpression('(20-5)*2')).toBe(30);
    expect(evalNumericExpression('-(10+5)')).toBe(-15);
    expect(evalNumericExpression('--5')).toBe(5);
    expect(evalNumericExpression('10 + -4')).toBe(6);
  });

  it('rechaza entradas inválidas o incompletas', () => {
    expect(evalNumericExpression('')).toBeNull();
    expect(evalNumericExpression('abc')).toBeNull();
    expect(evalNumericExpression('10+')).toBeNull();
    expect(evalNumericExpression('(10')).toBeNull();
    expect(evalNumericExpression('10/')).toBeNull();
    expect(evalNumericExpression('5/0')).toBeNull();
    expect(evalNumericExpression('1..2')).toBeNull();
    expect(evalNumericExpression('12mm')).toBeNull();
  });
});
