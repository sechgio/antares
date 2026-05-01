// Tests for Electron dialog IPC handling without requiring Electron at import time.
const { handleDialogCall } = require('../electron/dialog-handlers.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function run() {
  console.log('Testing dialog handlers...\n');

  const calls = [];
  const dialog = {
    async showOpenDialog(win, options) {
      calls.push({ kind: 'open', win, options });
      return { canceled: false, filePaths: ['C:/tmp/data.xlsx'] };
    },
    async showSaveDialog(win, options) {
      calls.push({ kind: 'save', win, options });
      return { canceled: false, filePath: 'C:/tmp/export.xlsx' };
    },
  };
  const win = { id: 1 };

  const files = await handleDialogCall('dialog_files', {}, dialog, win);
  assert(files.handled === true, 'dialog_files should be handled by Electron');
  assert(files.result.paths[0] === 'C:/tmp/data.xlsx', 'dialog_files should return selected file path');
  assert(calls[0].options.properties.includes('openFile'), 'dialog_files should use openFile');
  assert(calls[0].options.filters[0].extensions.includes('mp4'), 'dialog_files should accept MP4 videos');
  assert(calls[0].options.filters[0].extensions.includes('mkv'), 'dialog_files should accept MKV videos');

  const folder = await handleDialogCall('dialog_folder', {}, dialog, win);
  assert(folder.result.paths[0] === 'C:/tmp/data.xlsx', 'dialog_folder should return selected folder path');
  assert(calls[1].options.properties.includes('openDirectory'), 'dialog_folder should use openDirectory');

  const save = await handleDialogCall('dialog_save', {}, dialog, win);
  assert(save.result.paths[0] === 'C:/tmp/export.xlsx', 'dialog_save should return saved file path');
  assert(calls[2].options.title === 'Guardar archivo', 'dialog_save should set a save title');

  const ignored = await handleDialogCall('db_records', {}, dialog, win);
  assert(ignored.handled === false, 'non-dialog methods should not be handled');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
