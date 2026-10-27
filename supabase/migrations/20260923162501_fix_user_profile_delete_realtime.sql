-- Supabase Realtime requires FULL replica identity to apply filters to DELETE events.
ALTER TABLE public.user_profiles REPLICA IDENTITY FULL;
