-- T01: payload pending registration as a Supabase migration.
-- Do not deploy the frontend until a generated migration containing this SQL
-- has been committed and verified against a local/development database.
-- Create the migration with the installed CLI after inspecting its help:
--   supabase --help
--   supabase migration new --help
--   supabase migration new espacios_tarea_priority
-- Copy this payload into the path returned by the CLI; do not invent a version.
-- This file is deliberately outside supabase/migrations: the editing environment
-- did not have the CLI/PostgreSQL, so no generated or tested migration is claimed.
-- Never run a remote db push as a substitute for local verification.

begin;

-- No IF NOT EXISTS: fail rather than silently accepting a pre-existing column
-- with an incompatible type or constraints. The transaction rolls back on error.
alter table public.tareas add column priority text;

-- Preserve every task ID and every existing/customized workflow status.
-- The existing updated_at trigger may record this backfill as an update.
update public.tareas
set priority = case when status = 'urgent' then 'urgent' else 'normal' end;

alter table public.tareas
  alter column priority set default 'normal',
  alter column priority set not null,
  add constraint tareas_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent'));

comment on column public.tareas.priority is
  'Independent task priority. Legacy urgent statuses are preserved; changing priority never changes status.';

-- Existing table-level grants, RLS policies and triggers remain unchanged.
-- Verification still required: authenticated allowed/denied writes, custom
-- states, old-client inserts, and propagation of priority through Realtime.
commit;
