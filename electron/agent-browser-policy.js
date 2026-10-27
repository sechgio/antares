'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SEED_BLOCKED = [
  'bcp.pe', 'interbank.pe', 'scotiabank.pe', 'bbva.pe', 'bancofalabella.pe', 'cajaarequipa.pe',
  'paypal.com', 'mercadopago.com', 'niubiz.com.pe', 'stripe.com', 'sunat.gob.pe', 'reniec.gob.pe',
];

let cache;

function policyFile() {
  return path.join(require('./canvas-assets').antaresUserData('ai-agent'), 'browser-policy.json');
}

function load() {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(policyFile(), 'utf8'));
      if (!cache || typeof cache !== 'object' || Array.isArray(cache)) cache = {};
    } catch {
      cache = {};
    }
  }
  return cache;
}

function entries(key) {
  const value = load()[key];
  return Array.isArray(value) ? value.map((entry) => String(entry || '').toLowerCase()).filter(Boolean) : [];
}

function matches(host, entry) {
  return !!host && (host === entry || host.endsWith(`.${entry}`));
}

function hostOf(url) {
  try {
    return String(new URL(url).hostname || '').toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

function isBlocked(host) {
  return [...SEED_BLOCKED, ...entries('blocked')].some((entry) => matches(host, entry));
}

function isAlwaysAllowed(host) {
  return entries('always_allowed').some((entry) => matches(host, entry));
}

function addAlwaysAllowed(host) {
  const value = String(host || '').toLowerCase();
  if (!value || isAlwaysAllowed(value)) return;
  const data = { ...load(), always_allowed: [...entries('always_allowed'), value] };
  fs.mkdirSync(path.dirname(policyFile()), { recursive: true });
  fs.writeFileSync(policyFile(), JSON.stringify(data, null, 2));
  cache = data;
}

module.exports = { hostOf, isBlocked, isAlwaysAllowed, addAlwaysAllowed };
