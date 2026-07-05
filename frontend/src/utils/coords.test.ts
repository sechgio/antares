import { describe, expect, it } from 'vitest';
import { isValidCoord, parseCombinedCoords } from './coords';

describe('parseCombinedCoords', () => {
  it('splits a valid pair with spaces after the comma', () => {
    expect(parseCombinedCoords('-11.968553377375565, -76.97854079771369')).toEqual({
      lat: '-11.968553377375565',
      lon: '-76.97854079771369',
    });
  });

  it('splits a valid pair without spaces', () => {
    expect(parseCombinedCoords('-12.0464,-77.0428')).toEqual({
      lat: '-12.0464',
      lon: '-77.0428',
    });
  });

  it('returns null for a single coordinate without comma', () => {
    expect(parseCombinedCoords('-12.3456')).toBeNull();
  });

  it('returns null for non-numeric values', () => {
    expect(parseCombinedCoords('abc, def')).toBeNull();
  });

  it('returns null while longitude is incomplete', () => {
    expect(parseCombinedCoords('-12.0464, -77.')).toBeNull();
  });

  it('returns null when a part is empty', () => {
    expect(parseCombinedCoords('-12.0464,')).toBeNull();
    expect(parseCombinedCoords(', -77.0428')).toBeNull();
  });
});

describe('isValidCoord', () => {
  it('accepts complete numeric coordinates', () => {
    expect(isValidCoord('-11.968674')).toBe(true);
    expect(isValidCoord('-77.0428')).toBe(true);
  });

  it('rejects incomplete or non-numeric values', () => {
    expect(isValidCoord('-77.')).toBe(false);
    expect(isValidCoord('')).toBe(false);
    expect(isValidCoord('abc')).toBe(false);
  });
});
