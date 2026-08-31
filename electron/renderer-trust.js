const path = require('path');
const { pathToFileURL } = require('url');

const PACKAGED_RENDERER_URL = pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'dist', 'index.html'),
).toString();

function isTrustedRendererUrl(rawUrl, isDev) {
  if (typeof rawUrl !== 'string' || !rawUrl) return false;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (isDev) {
    return (
      url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      && url.port === '5173'
      && !url.username
      && !url.password
    );
  }

  return url.href === PACKAGED_RENDERER_URL;
}

function isTrustedRendererFrame(event, mainWindow, isDev) {
  const frame = event?.senderFrame;
  const sender = event?.sender;
  const webContents = mainWindow && !mainWindow.isDestroyed?.() ? mainWindow.webContents : null;
  if (!frame || !sender || !webContents || sender.id !== webContents.id) return false;

  if (sender.mainFrame && frame !== sender.mainFrame) return false;
  if (frame.parent !== undefined && frame.parent !== null) return false;
  return isTrustedRendererUrl(frame.url, isDev);
}

module.exports = {
  PACKAGED_RENDERER_URL,
  isTrustedRendererUrl,
  isTrustedRendererFrame,
};
