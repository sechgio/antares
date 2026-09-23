-- Supabase Realtime requires FULL replica identity to apply filters to DELETE events.
-- user_profiles is filtered by user_id so clients can immediately close deleted users' sessions.
ALTER TABLE public.user_profiles REPLICA IDENTITY FULL;
