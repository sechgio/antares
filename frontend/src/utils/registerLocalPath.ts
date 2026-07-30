/** Register absolute paths with Electron allowlist (drag-drop / thumbnails). */
export function registerLocalPath(path: string | undefined | null): Promise<void> {
  if (!path) return Promise.resolve();
  const fn = window.electronAPI?.registerLocalPath;
  if (!fn) return Promise.resolve();
  return fn(path).then(() => undefined).catch(() => undefined);
}

export function registerLocalPaths(paths: Iterable<string>): Promise<void> {
  const list = [...paths].filter((p): p is string => Boolean(p));
  if (list.length === 0) return Promise.resolve();
  return Promise.all(list.map((p) => registerLocalPath(p))).then(() => undefined);
}
