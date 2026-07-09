#!/usr/bin/env node

/**
 * Instala hooks de git del repo (.githooks) vía core.hooksPath.
 * Uso: node scripts/install-hooks.js
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const hooksPath = path.join(ROOT, '.githooks');

try {
  execSync(`git config core.hooksPath "${hooksPath.replace(/\\/g, '/')}"`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
  console.log(`✓ Git hooks instalados desde ${hooksPath}`);
  console.log('  pre-commit: bloquea .env.local y credenciales Supabase');
  console.log('  pre-push: bloquea push directo a main');
} catch (err) {
  console.error('✗ No se pudieron instalar hooks:', err.message);
  process.exit(1);
}
