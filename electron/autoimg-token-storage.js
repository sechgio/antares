const { readSecureJson, writeSecureJson, clearSecureJson } = require('./autoimg-secure-storage');

const FILE = 'autoimg-tokens.json';
const NS = 'tokens';

function loadTokens() {
  return readSecureJson(FILE, NS);
}

function saveTokens(tokens) {
  writeSecureJson(FILE, NS, tokens);
}

function clearTokens() {
  clearSecureJson(FILE);
}

module.exports = { loadTokens, saveTokens, clearTokens };