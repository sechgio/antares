import { describe, expect, it } from 'vitest';
import { arrayBufferToBase64, base64ToBytes, bytesToBase64 } from './bytesToBase64';

describe('bytesToBase64', () => {
  it('encodes empty input', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });

  it('matches btoa for small payloads', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]);
    expect(bytesToBase64(bytes)).toBe(btoa('Hello'));
  });

  it('handles buffers larger than the 32 KiB chunk', () => {
    const size = 0x8000 + 100;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 256;
    const encoded = bytesToBase64(bytes);
    expect(atob(encoded).length).toBe(size);
    expect(arrayBufferToBase64(bytes.buffer)).toBe(encoded);
  });
});

describe('base64ToBytes', () => {
  it('round-trips through bytesToBase64', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]);
    const encoded = bytesToBase64(original);
    const decoded = base64ToBytes(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('handles empty input', () => {
    expect(base64ToBytes('').length).toBe(0);
  });
});
