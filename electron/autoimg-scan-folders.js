const { mapWithConcurrency } = require('./autoimg-concurrency');
const { accumulateNisFiles, finalizeNisMap } = require('./autoimg-nis');

const DEFAULT_SCAN_CONCURRENCY = 3;

async function scanActiveFolders(activeFolders, {
  drive,
  emit,
  shouldCancel,
  buildFolderErrorSummary,
  concurrency = DEFAULT_SCAN_CONCURRENCY,
}) {
  const scanOne = async (folder, index) => {
    emit('autoimg.scan.folder_start', {
      folder: folder.name,
      index: index + 1,
      total: activeFolders.length,
    });

    try {
      const nisMap = {};
      let fileCount = 0;
      await drive.listFolder(folder.folder_id, {
        collect: false,
        onPage: ({ pageFiles, totalSoFar, hasMore }) => {
          shouldCancel?.();
          fileCount = totalSoFar;
          accumulateNisFiles(nisMap, pageFiles, folder.name);
          const lastFile = pageFiles[pageFiles.length - 1];
          emit('autoimg.scan.progress', {
            folder: folder.name,
            current: totalSoFar,
            total: hasMore ? totalSoFar + 1 : totalSoFar,
            file: lastFile?.name || '',
          });
        },
      });
      shouldCancel?.();

      const finalized = finalizeNisMap(nisMap);
      const nisFound = Object.keys(finalized).length;
      emit('autoimg.scan.folder_done', {
        folder: folder.name,
        count: fileCount,
        nis_found: nisFound,
      });

      return {
        index,
        ok: true,
        folderSummary: {
          name: folder.name,
          folder_id: folder.folder_id,
          count: fileCount,
          nis_found: nisFound,
        },
        nisMap: finalized,
        fileCount,
      };
    } catch (err) {
      const failed = buildFolderErrorSummary(folder, err);
      emit('autoimg.scan.folder_error', {
        folder: folder.name,
        error: failed.error,
        index: index + 1,
        total: activeFolders.length,
      });
      emit('autoimg.scan.folder_done', {
        folder: folder.name,
        count: 0,
        nis_found: 0,
        error: failed.error,
      });
      return {
        index,
        ok: false,
        folderSummary: failed,
        nisMap: null,
        fileCount: 0,
      };
    }
  };

  const results = await mapWithConcurrency(
    activeFolders,
    concurrency,
    scanOne,
    { shouldCancel },
  );

  const folderSummary = results.map((r) => r.folderSummary);
  const nisMaps = results.filter((r) => r.ok && r.nisMap).map((r) => r.nisMap);
  const totalFiles = results.reduce((sum, r) => sum + r.fileCount, 0);
  const foldersFailed = results.filter((r) => !r.ok).length;

  return { folderSummary, nisMaps, totalFiles, foldersFailed };
}

module.exports = {
  DEFAULT_SCAN_CONCURRENCY,
  scanActiveFolders,
};
