/** Register absolute paths with Electron allowlist (drag-drop / thumbnails). */
export function registerLocalPath(path: string | undefined | null): void {
  if (!path) return;
  const fn = window.electronAPI?.registerLocalPath;
  if (fn) void fn(path).catch(() => {});
}

export function registerLocalPaths(paths: Iterable<string>): void {
  for (const p of paths) registerLocalPath(p);
}
