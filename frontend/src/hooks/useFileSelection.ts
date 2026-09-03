import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

export function useFileSelection(files: string[]) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const filesRef = useRef(files);

  useEffect(() => { filesRef.current = files; }, [files]);

  const filesSet = useMemo(() => new Set(files), [files]);

  useEffect(() => {
    setSelectedFiles((prev) => {
      let needsUpdate = false;
      for (const f of prev) {
        if (!filesSet.has(f)) { needsUpdate = true; break; }
      }
      if (!needsUpdate) return prev;
      const next = new Set<string>();
      for (const f of prev) {
        if (filesSet.has(f)) next.add(f);
      }
      return next;
    });
    setSelectedFile((prev) => (prev == null || filesSet.has(prev) ? prev : null));
  }, [filesSet]);

  const handleFileClick = useCallback((e: React.MouseEvent, path: string) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path); else next.add(path);
        return next;
      });
      setSelectedFile(path);
    } else if (e.shiftKey) {
      e.preventDefault();
      setSelectedFile((prevSel) => {
        const anchorPath = prevSel || filesRef.current[0];
        const idx2 = filesRef.current.indexOf(path);
        if (idx2 < 0) {
          setSelectedFiles(new Set([path]));
          return path;
        }
        const idx1 = filesRef.current.indexOf(anchorPath);
        const anchorIdx = idx1 < 0 ? idx2 : idx1;
        const start = Math.min(anchorIdx, idx2);
        const end = Math.max(anchorIdx, idx2);
        setSelectedFiles((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) {
            const f = filesRef.current[i];
            if (f !== undefined) next.add(f);
          }
          return next;
        });
        return path;
      });
    } else {
      setSelectedFile(path);
      setSelectedFiles(new Set([path]));
    }
  }, []);

  const handleFileDoubleClick = useCallback((_e: React.MouseEvent, path: string) => {
    setSelectedFile(path);
    setSelectedFiles(new Set([path]));
  }, []);

  const selectAllFiles = useCallback(() => {
    setSelectedFiles((prev) => prev.size === filesRef.current.length ? new Set() : new Set(filesRef.current));
  }, []);

  return {
    selectedFile, setSelectedFile,
    selectedFiles, setSelectedFiles,
    handleFileClick, handleFileDoubleClick, selectAllFiles,
  };
}
