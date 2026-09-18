const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'supabase', 'functions', 'admin-delete-user', 'index.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`✗ ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

console.log('Testing admin-delete-user privilege contract...\n');

assert(
  source.includes('userClient.rpc("admin_delete_user"'),
  'user deletion must go through the caller-authenticated admin_delete_user RPC',
);
assert(
  !source.includes('SUPABASE_SERVICE_ROLE_KEY'),
  'deletion must not use a service-role client; the RPC keeps least privilege',
);
assert(
  !source.includes('auth.admin.deleteUser'),
  'deletion must not call auth.admin.deleteUser directly',
);
assert(
  source.includes('req.headers.get("Authorization")'),
  'the endpoint must require a Bearer token',
);
assert(
  /userClient\s*\n?\s*\.from\("user_profiles"\)[\s\S]{0,200}\.eq\("user_id",\s*callerUser\.id\)/.test(source),
  'the admin check must read the caller profile with the caller-authenticated client (RLS applies)',
);
assert(
  source.includes('profile.is_disabled'),
  'disabled admins must be rejected',
);
assert(
  source.includes('targetUserId === callerUser.id'),
  'self-deletion must be blocked',
);
assert(
  source.indexOf('UUID_RE.test') < source.indexOf('userClient.auth.getUser'),
  'the user_id UUID must be validated before any privileged work',
);
