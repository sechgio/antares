import { useCallback, useMemo, useState } from 'react';
import { mapWithConcurrencyLimit } from '../../utils/mapWithConcurrencyLimit';
import { cleanupStagedToken, hasFileStagingBridge, stageFileForIpc } from '../../utils/stageFile';

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
      const incomingPaths = new Set(Object.keys(fileEntries));
      setFileTokens((previous) => {
        for (const filePath of incomingPaths) {
          const token = previous[filePath];
          if (token) cleanupStagedToken(token);
        }
        return removeKeys(previous, incomingPaths);
      });
      setFileObjects((previous) => ({ ...previous, ...fileEntries }));
    }
  }, []);

  const removeFileRefs = useCallback((paths: Iterable<string>) => {
    const keys = new Set(paths);
    if (keys.size === 0) return;
    setFileTokens((previous) => {
      for (const filePath of keys) {
        const token = previous[filePath];
        if (token) cleanupStagedToken(token);
      }
      return removeKeys(previous, keys);
    });
    setFileObjects((previous) => removeKeys(previous, keys));
  }, []);

  const clearFileRefs = useCallback(() => {
    setFileTokens((previous) => {
      for (const token of Object.values(previous)) cleanupStagedToken(token);
      return {};
    });
    setFileObjects({});
  }, []);

  const resolveFileRefs = useCallback(async (paths: readonly string[]): Promise<string[]> => {
    const stagedThisPass: Record<string, string> = {};
    const resolved = await mapWithConcurrencyLimit(paths, STAGE_CONCURRENCY, async (filePath) => {
      const existing = fileTokens[filePath] || stagedThisPass[filePath];
      if (existing) return existing;

      const file = fileObjects[filePath];
      if (file) {
        const staged = await stageFileForIpc(file, { reuse: true });
        if (staged) {
          stagedThisPass[filePath] = staged;
          return staged;
        }
        if (hasStagingBridge) {
          throw new Error(`No se pudo preparar el archivo "${file.name}" para IPC.`);
        }
      }

      if (hasStagingBridge) {
        throw new Error(`El archivo "${filePath}" necesita volver a cargarse para continuar.`);
      }
      return filePath;
    });
    if (Object.keys(stagedThisPass).length > 0) {
      setFileTokens((previous) => ({ ...previous, ...stagedThisPass }));
    }
    return resolved;
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
