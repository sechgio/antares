const sheets = require('./google-sheets-service');
const drive = require('./google-drive-service');
const { appendLogEvent } = require('./app-log');
const { OperationCancelledError, mapWithConcurrency } = require('./autoimg-concurrency');
const { buildNisMetaMap, buildRenameJobs, uniqueDestinos } = require('./autoimg-rename');
const { saveRenameDest } = require('./autoimg-user-store');
const { emit } = require('./autoimg-notify');
const { operationState, throwIfCancelled, runLocked } = require('./autoimg-operations');
const {
  RENAME_DEST_CONFIG_KEY,
  tryUpsertConfigValues,
  ensureSheetId,
} = require('./autoimg-sheet-config');
const { scanAllCore, nowStamp } = require('./autoimg-scan-sync');

const RENAME_COPY_CONCURRENCY_MIN = 2;
const RENAME_COPY_CONCURRENCY_MAX = 8;

let _renameConcurrencyBias = 0;

function resolveRenameCopyConcurrency(jobCount) {
  const n = Number(jobCount) || 0;
  let base = 3;
  if (n >= 40) base = 6;
  else if (n >= 15) base = 4;
  const bias = Math.max(0, Math.min(4, _renameConcurrencyBias));
  return Math.max(
    RENAME_COPY_CONCURRENCY_MIN,
    Math.min(RENAME_COPY_CONCURRENCY_MAX, base - bias),
  );
}

function _noteRenameRateLimit() {
  _renameConcurrencyBias = Math.min(4, _renameConcurrencyBias + 1);
}

function _noteRenameBatchClean() {
  _renameConcurrencyBias = Math.max(0, _renameConcurrencyBias - 1);
}

function _isRateLimitError(err) {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /429|rate limit|Rate limit/i.test(msg);
}

async function _renameExportCore({ dest_folder_id, only_completos = true } = {}) {
  await ensureSheetId();
  throwIfCancelled();

  const rootMeta = await drive.assertDriveFolder(dest_folder_id);
  const rootFolderId = rootMeta.folder_id;

  const { values: bdValues } = await sheets.readRange('BD_IMG!A:C');
  const nisMeta = buildNisMetaMap(bdValues);

  const scan = await scanAllCore();
  throwIfCancelled();

  const { jobs, skipped } = buildRenameJobs(scan.results.nis_results, nisMeta, {
    onlyCompletos: only_completos !== false,
  });

  const destinoNames = uniqueDestinos(jobs);
  const destinoFolderIds = new Map();
  const foldersCreated = [];
  for (const name of destinoNames) {
    throwIfCancelled();
    const sub = await drive.findOrCreateSubfolder(rootFolderId, name);
    destinoFolderIds.set(name, sub.folder_id);
    if (sub.created) foldersCreated.push(name);
    emit('autoimg.rename.folder', {
      name,
      folder_id: sub.folder_id,
      created: sub.created,
    });
  }

  emit('autoimg.rename.plan', {
    total_jobs: jobs.length,
    skipped: skipped.length,
    dest_folder_id: rootFolderId,
    dest_name: rootMeta.name,
    destinos: destinoNames.length,
    folders_created: foldersCreated.length,
  });

  const copied = [];
  const failed = [];
  let done = 0;
  const copyConcurrency = resolveRenameCopyConcurrency(jobs.length);
  let hitRateLimit = false;
  let cancelledMidCopy = false;

  try {
    await mapWithConcurrency(
      jobs,
      copyConcurrency,
      async (job) => {
        throwIfCancelled({
          phase: 'rename_copy',
          copied: copied.length,
          failed: failed.length,
          planned: jobs.length,
        });
        const targetFolderId = destinoFolderIds.get(job.destino);
        try {
          if (!targetFolderId) {
            throw new Error(`Sin carpeta para DESTINO "${job.destino}"`);
          }
          const res = await drive.copyFileToFolder(job.fileId, targetFolderId, job.toName);
          copied.push({
            nis: job.nis,
            sgio: job.sgio,
            destino: job.destino,
            slot: job.slot,
            from: job.fromName,
            to: job.toName,
            folder: job.destino,
            file_id: res.id || '',
          });
        } catch (err) {
          if (err instanceof OperationCancelledError) throw err;
          if (_isRateLimitError(err)) hitRateLimit = true;
          failed.push({
            nis: job.nis,
            sgio: job.sgio,
            destino: job.destino,
            from: job.fromName,
            to: job.toName,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          done += 1;
          emit('autoimg.rename.progress', {
            current: done,
            total: jobs.length,
            last: `${job.destino}/${job.toName}`,
          });
        }
      },
      { shouldCancel: () => operationState.cancelRequested },
    );
  } catch (err) {
    if (err instanceof OperationCancelledError || operationState.cancelRequested) {
      cancelledMidCopy = true;
      const partial = {
        phase: 'rename_copy',
        copied: copied.length,
        failed: failed.length,
        planned: jobs.length,
        skipped: skipped.length,
        dest_folder_id: rootFolderId,
      };
      emit('autoimg.rename.partial', partial);
      const cancelErr = new OperationCancelledError(
        `Renombre cancelado: ${copied.length}/${jobs.length} copias ya hechas en Drive`,
        partial,
      );
      throw cancelErr;
    }
    throw err;
  }

  if (hitRateLimit) _noteRenameRateLimit();
  else if (failed.length === 0 && jobs.length > 0) _noteRenameBatchClean();

  const configPersistence = await tryUpsertConfigValues({ [RENAME_DEST_CONFIG_KEY]: rootFolderId });
  try {
    saveRenameDest(rootFolderId, rootMeta.name);
  } catch {}

  const detail =
    `Renombre SGIO → ${rootMeta.name}/{DESTINO}: ${copied.length} copiadas` +
    (foldersCreated.length ? `, ${foldersCreated.length} carpeta(s) nuevas` : '') +
    (failed.length ? `, ${failed.length} error(es)` : '') +
    (skipped.length ? `, ${skipped.length} omitida(s)` : '') +
    (cancelledMidCopy ? ', cancelado' : '');

  try {
    await sheets.appendRow('LOGS!A:E', [nowStamp(), 'RENAME_SGIO', detail, '', '']);
  } catch {}

  appendLogEvent('INFO', 'autoimg.rename_complete', {
    component: 'electron',
    outcome: failed.length === 0 ? 'success' : 'partial',
    count: copied.length,
    message: `AutoIMG rename complete: ${copied.length} copied, ${failed.length} failed, ${skipped.length} skipped`,
  });
  emit('autoimg.rename.complete', {
    copied: copied.length,
    failed: failed.length,
    skipped: skipped.length,
    dest_folder_id: rootFolderId,
    folders_created: foldersCreated.length,
  });

  return {
    success: failed.length === 0,
    dest_folder_id: rootFolderId,
    dest_name: rootMeta.name,
    destinos: destinoNames,
    folders_created: foldersCreated,
    copied,
    failed,
    skipped,
    planned: jobs.length,
    scan_summary: scan.summary,
    partial: !configPersistence.persisted,
    config_persisted: configPersistence.persisted,
    ...(configPersistence.error ? { warning: configPersistence.error } : {}),
  };
}

async function renameExport(params = {}) {
  if (params?.dest_folder_id) {
    try {
      saveRenameDest(String(params.dest_folder_id), '');
    } catch {}
  }
  return runLocked('rename', () => _renameExportCore(params));
}

module.exports = { renameExport, resolveRenameCopyConcurrency };
