-- Drop unused vistas table (Espacios views are client-side sessionPrefs only).
-- GraphQL schema exposure and leaked-password protection require Management API
-- (PATCH postgrest / config/auth); SQL cannot revoke supabase_admin schema grants
-- nor toggle password_hibp_enabled.

DROP TABLE IF EXISTS public.vistas CASCADE;
