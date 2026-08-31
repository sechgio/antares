import { useCallback, useMemo, useState } from 'react';
import { mapWithConcurrencyLimit } from '../../utils/mapWithConcurrencyLimit';
import { hasFileStagingBridge, stageFileForIpc } from '../../utils/stageFile';

const READ_FILE_TOKEN_PREFIX = 'antares-read_';
const STAGE_CONCURRENCY = 4;

function removeKeys<T>(values: Record<string, T>, keys: Set<string>): Record<string, T> {
  let changed = false;
  const next = { ...values };
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    delete next[key];
    changed = true;
  }
  return changed ? next : values;
}

export function useConversionFileRefs(files: readonly string[]) {
  const [fileTokens, setFileTokens] = useState<Record<string, string>>({});
  const [fileObjects, setFileObjects] = useState<Record<string, File>>({});
  const hasStagingBridge = hasFileStagingBridge();

  const fileRefsReady = useMemo(
    () => !hasStagingBridge || files.every((filePath) => Boolean(fileTokens[filePath] || fileObjects[filePath])),
    [files, fileObjects, fileTokens, hasStagingBridge],
  );

  const mergeFiles = useCallback((incoming: string[], incomingTokens: string[] = [], incomingFiles: File[] = []) => {
    if (!incoming.length) return;

    const tokenEntries = incoming.reduce<Record<string, string>>((acc, filePath, index) => {
      const token = incomingTokens[index];
      if (typeof token === 'string' && token.startsWith(READ_FILE_TOKEN_PREFIX)) acc[filePath] = token;
      return acc;
    }, {});
    if (Object.keys(tokenEntries).length > 0) {
      setFileTokens((previous) => ({ ...previous, ...tokenEntries }));
    }

    const fileEntries = incoming.reduce<Record<string, File>>((acc, filePath, index) => {
      const file = incomingFiles[index];
      if (file) acc[filePath] = file;
      return acc;
    }, {});
    if (Object.keys(fileEntries).length > 0) {
      setFileObjects((previous) => ({ ...previous, ...fileEntries }));
    }
  }, []);

  const removeFileRefs = useCallback((paths: Iterable<string>) => {
    const keys = new Set(paths);
    if (keys.size === 0) return;
    setFileTokens((previous) => removeKeys(previous, keys));
    setFileObjects((previous) => removeKeys(previous, keys));
  }, []);

  const clearFileRefs = useCallback(() => {
    setFileTokens({});
    setFileObjects({});
  }, []);

  const resolveFileRefs = useCallback(async (paths: readonly string[]): Promise<string[]> => {
    return mapWithConcurrencyLimit(paths, STAGE_CONCURRENCY, async (filePath) => {
      const file = fileObjects[filePath];
      if (file) {
        const staged = await stageFileForIpc(file);
        if (staged) return staged;
        if (hasStagingBridge) {
          throw new Error(`No se pudo preparar el archivo "${file.name}" para IPC.`);
        }
      }

      const token = fileTokens[filePath];
      if (token) return token;
      if (hasStagingBridge) {
        throw new Error(`El archivo "${filePath}" necesita volver a cargarse para continuar.`);
      }
      // Browser/unit-test fallback. Electron rejects raw paths at the boundary;
      // desktop calls with the bridge always return a capability token.
      return filePath;
    });
  }, [fileObjects, fileTokens, hasStagingBridge]);

  return {
    clearFileRefs,
    fileObjects,
    fileRefsReady,
    fileTokens,
    hasStagingBridge,
    mergeFiles,
    removeFileRefs,
    resolveFileRefs,
  };
}
