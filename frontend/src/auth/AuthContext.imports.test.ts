import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Cold-start guard: AuthProvider mounts with the app shell. A static import of
 * `supabase` pulls `@supabase/supabase-js` (~209 KB) into the entry preload.
 * Auth must load the client via dynamic import after first paint.
 */
describe('AuthContext import graph', () => {
  const src = fs.readFileSync(path.join(__dirname, 'AuthContext.tsx'), 'utf8');

  it('does not statically import the supabase client value', () => {
    expect(src).not.toMatch(
      /import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*['"]\.\.\/lib\/supabase['"]/,
    );
  });

  it('loads supabase via dynamic import', () => {
    expect(src).toMatch(/import\(\s*['"]\.\.\/lib\/supabase['"]\s*\)/);
  });
});
