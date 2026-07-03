import { describe, expect, it } from 'vitest';
import { parseDriveFolderId } from './parseDriveFolderId';

describe('parseDriveFolderId', () => {
  it('returns raw folder id when already valid', () => {
    expect(parseDriveFolderId('1abcDEFghijklmnop')).toBe('1abcDEFghijklmnop');
  });

  it('extracts id from standard Drive folder URL', () => {
    expect(parseDriveFolderId('https://drive.google.com/drive/folders/1abcXYZ_123')).toBe('1abcXYZ_123');
  });

  it('extracts id from URL with id query param', () => {
    expect(parseDriveFolderId('https://drive.google.com/open?id=1abcXYZ_123')).toBe('1abcXYZ_123');
  });

  it('returns null for empty or invalid input', () => {
    expect(parseDriveFolderId('')).toBeNull();
    expect(parseDriveFolderId('not-a-url')).toBeNull();
  });
});