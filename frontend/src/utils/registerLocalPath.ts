/** Register absolute paths with Electron allowlist (drag-drop / thumbnails). */
export async function registerLocalPath(path: string | undefined | null): Promise<boolean> {
  if (!path) return true;
  const fn = window.electronAPI?.registerLocalPath;
  if (!fn) return true;
  try {
    await fn(path);
    return true;
  } catch (err) {
    console.warn('[registerLocalPath] failed:', path, err);
    return false;
  }
}

export async function registerLocalPaths(paths: Iterable<string>): Promise<boolean> {
  const list = [...paths].filter((p): p is string => Boolean(p));
  if (list.length === 0) return true;
  const results = await Promise.all(list.map((p) => registerLocalPath(p)));
  return results.every(Boolean);
}
