const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const migrationsDir = path.join(ROOT, 'supabase', 'migrations');
const migrationNames = fs.readdirSync(migrationsDir);

function readMigration(suffix) {
  const name = migrationNames.find((candidate) => candidate.endsWith(suffix));
  if (!name) throw new Error(`Falta migración ${suffix}`);
  return fs.readFileSync(path.join(migrationsDir, name), 'utf8');
}

const priority = readMigration('_espacios_tarea_priority.sql');
const feature = readMigration('_espacios_task_activity_and_my_tasks.sql');

const checks = [
  [priority, /alter table public\.tareas add column priority text/i, 'registra la columna priority pendiente de T01'],
  [feature, /create table public\.tarea_comments/i, 'crea tarea_comments'],
  [feature, /create table public\.tarea_activity/i, 'crea tarea_activity'],
  [feature, /check \(length\(btrim\(body\)\) > 0\)/i, 'rechaza comentarios vacíos'],
  [feature, /create index idx_tarea_comments_tarea_created/i, 'indexa comentarios por tarea y fecha'],
  [feature, /create index idx_tarea_activity_tarea_created/i, 'indexa actividad por tarea y fecha'],
  [feature, /enable row level security/i, 'activa RLS'],
  [feature, /grant select, insert, update, delete on table public\.tarea_comments to authenticated/i, 'limita grants de comentarios'],
  [feature, /grant select on table public\.tarea_activity to authenticated/i, 'actividad es solo lectura para clientes'],
  [feature, /revoke all on table public\.tarea_activity from anon, authenticated/i, 'revoca manipulación de actividad'],
  [feature, /security definer/i, 'el trigger interno usa privilegios acotados'],
  [feature, /revoke all on function private\.record_tarea_activity\(\) from public, anon, authenticated/i, 'el trigger interno no es invocable por clientes'],
  [feature, /is distinct from/i, 'compara cambios campo a campo sin ruido'],
  [feature, /create view public\.mis_tareas[\s\S]*security_invoker\s*=\s*true/i, 'la vista global respeta RLS'],
  [feature, /create view public\.mis_tareas_origenes[\s\S]*security_invoker\s*=\s*true/i, 'los filtros globales usan una vista compacta y segura'],
  [feature, /t\.assignee_id\s*=\s*\(select auth\.uid\(\)\)/i, 'la vista solo devuelve tareas propias'],
  [feature, /author_id uuid references auth\.users\(id\) on delete set null/i, 'conserva comentarios al borrar un usuario'],
  [feature, /author_name text not null/i, 'conserva una etiqueta legible del autor'],
  [feature, /alter publication supabase_realtime add table public\.tarea_comments/i, 'publica comentarios en Realtime'],
  [feature, /alter publication supabase_realtime add table public\.tarea_activity/i, 'publica actividad en Realtime'],
];

for (const [source, pattern, label] of checks) {
  if (!pattern.test(source)) throw new Error(`[FAIL] Migración T03/T04 no ${label}`);
}

console.log(`[PASS] Migraciones de Espacios T03/T04: ${checks.length} invariantes verificadas.`);
