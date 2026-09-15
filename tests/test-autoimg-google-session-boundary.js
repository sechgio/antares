const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const electronDir = path.join(__dirname, '..', 'electron');
const sessionPath = path.join(electronDir, 'google-session.js');
const sheetsPath = path.join(electronDir, 'google-sheets-service.js');
const drivePath = path.join(electronDir, 'google-drive-service.js');

assert.equal(fs.existsSync(sessionPath), true, 'google-session.js debe ser el seam compartido de autenticación');

const sheetsSource = fs.readFileSync(sheetsPath, 'utf8');
const driveSource = fs.readFileSync(drivePath, 'utf8');
assert.match(sheetsSource, /require\(['"]\.\/google-session['"]\)/);
assert.match(driveSource, /require\(['"]\.\/google-session['"]\)/);
assert.doesNotMatch(driveSource, /require\(['"]\.\/google-sheets-service['"]\)/);

const session = require(sessionPath);
const sheets = require(sheetsPath);
assert.equal(sheets.getValidTokens, session.getValidTokens, 'Sheets conserva el facade compatible de tokens');
assert.equal(sheets.refreshAccessToken, session.refreshAccessToken, 'Sheets conserva el facade compatible de refresh');

console.log('[PASS] Google session boundary shared by Drive and Sheets.');
