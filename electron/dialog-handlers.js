const fs = require('fs');
const os = require('os');
const path = require('path');

const DIALOG_METHODS = new Set(['dialog_files', 'dialog_folder', 'dialog_dest', 'dialog_save']);
const NATIVE_METHODS = new Set([...DIALOG_METHODS, 'html_to_pdf']);

function resultFromOpenDialog(response) {
  if (response.canceled) return { paths: [] };
  return { paths: response.filePaths || [] };
}

function resultFromSaveDialog(response) {
  if (response.canceled || !response.filePath) return { paths: [] };
  return { paths: [response.filePath] };
}

async function renderHtmlToPdf(params = {}, electronModules = {}) {
  const html = typeof params.html === 'string' ? params.html : '';
  if (!html.trim()) {
    throw new Error('HTML requerido para generar PDF');
  }

  const { BrowserWindow } = electronModules;
  if (!BrowserWindow) {
    throw new Error('BrowserWindow no disponible para generar PDF');
  }

  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  let tempDir = null;
  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cosmo-pdf-'));
    const htmlPath = path.join(tempDir, 'render.html');
    await fs.promises.writeFile(htmlPath, html, 'utf8');

    const didFinishLoad = new Promise((resolve, reject) => {
      pdfWindow.webContents.once('did-finish-load', resolve);
      pdfWindow.webContents.once('did-fail-load', (_event, _code, description) => {
        reject(new Error(description || 'No se pudo cargar el HTML para PDF'));
      });
    });

    await pdfWindow.loadFile(htmlPath);
    await didFinishLoad;

    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
      margins: { marginType: 'none' },
    });

    return {
      pdf_base64: Buffer.from(pdfBuffer).toString('base64'),
      filename: params.filename || 'reporte.pdf',
    };
  } finally {
    if (!pdfWindow.isDestroyed || !pdfWindow.isDestroyed()) {
      pdfWindow.close();
    }
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function handleDialogCall(method, params = {}, dialog, window, electronModules = {}) {
  if (!NATIVE_METHODS.has(method)) {
    return { handled: false };
  }

  if (method === 'html_to_pdf') {
    return { handled: true, result: await renderHtmlToPdf(params, electronModules) };
  }

  if (method === 'dialog_save') {
    const response = await dialog.showSaveDialog(window, {
      title: params.title || 'Guardar archivo',
      defaultPath: params.defaultPath,
      filters: params.filters || [
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    return { handled: true, result: resultFromSaveDialog(response) };
  }

  const properties = method === 'dialog_folder' || method === 'dialog_dest'
    ? ['openDirectory']
    : ['openFile', 'multiSelections'];

  const response = await dialog.showOpenDialog(window, {
    title: params.title || (properties.includes('openDirectory') ? 'Seleccionar carpeta' : 'Seleccionar archivos'),
    properties,
    filters: params.filters || [
      { name: 'Archivos compatibles', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'ico', 'pdf', 'mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v', '3gp', 'mpg', 'mpeg', 'xlsx', 'xls'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });

  return { handled: true, result: resultFromOpenDialog(response) };
}

module.exports = { handleDialogCall };
