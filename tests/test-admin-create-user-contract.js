const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'supabase', 'functions', 'admin-create-user', 'index.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`✗ ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

console.log('Testing admin-create-user privilege contract...\n');

assert(
  source.includes('userClient.rpc("admin_set_admin"'),
  'admin promotion must use the caller-authenticated admin_set_admin RPC',
);
assert(
  source.includes('adminClient.auth.admin.deleteUser'),
  'failed admin promotion must clean up the newly created Auth user',
);
assert(
  !/adminClient\s*\n?\s*\.from\("user_profiles"\)[\s\S]{0,180}\.update\(\{\s*is_admin\s*:\s*true/.test(source),
  'admin promotion must not update user_profiles through the service-role client',
);
