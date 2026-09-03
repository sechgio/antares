import { describe, expect, it } from 'vitest';

import { safeBase64ToBytes } from './base64';

describe('safeBase64ToBytes', () => {
  it('decodes a well-formed base64 string into a Uint8Array', () => {
    const bytes = safeBase64ToBytes('JVBERi0=');
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70, 45]);
    expect(bytes.buffer.byteLength).toBe(5);
  });

  it('strips internal whitespace before decoding', () => {
    const bytes = safeBase64ToBytes('JVBE Ri0=');
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70, 45]);
  });

  it('rejects empty input', () => {
    expect(() => safeBase64ToBytes('')).toThrow('Datos base64 inválidos');
    expect(() => safeBase64ToBytes(undefined as unknown as string)).toThrow('Datos base64 inválidos');
  });

  it('rejects non-base64 characters', () => {
    expect(() => safeBase64ToBytes('%%%')).toThrow('Datos base64 corruptos');
  });

  it('rejects length % 4 === 1 inputs (impossible base64)', () => {
    expect(() => safeBase64ToBytes('A')).toThrow('Datos base64 corruptos');
  });

  it('preserves byte values 0-255 round-trip', () => {
    const original = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
    let binary = '';
    for (let i = 0; i < original.length; i++) binary += String.fromCharCode(original[i]);
    // eslint-disable-next-line deprecation/deprecation
    const encoded = btoa(binary);
    const decoded = safeBase64ToBytes(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});
