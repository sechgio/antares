import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase, type AppUser } from '../lib/supabase';

export const DISABLED_ACCOUNT_MESSAGE =
  'Tu cuenta ha sido desactivada. Contacta al administrador.';

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function _fetchProfile(userId: string): Promise<Partial<AppUser> | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('display_name, is_admin, is_disabled')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return {
    displayName: data.display_name ?? null,
    isAdmin: !!data.is_admin,
    isDisabled: !!data.is_disabled,
  };
}

function _mapUser(supabaseUser: { id: string; email?: string; created_at?: string }, profile: Partial<AppUser> | null): AppUser {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? '',
    displayName: profile?.displayName ?? null,
    isAdmin: profile?.isAdmin ?? false,
    isDisabled: profile?.isDisabled ?? false,
    createdAt: supabaseUser.created_at ?? '',
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const loadingRef = useRef(loading);
  // authGenRef serialises refreshUser and onAuthStateChange: each in-flight
  // auth check increments the generation and only the latest one is allowed
  // to flip `loading=false`. Without this, when Supabase is slow the safety
  // timeout can flip loading to false and then a late onAuthStateChange
  // resolves and calls setUser without re-entering the loading state,
  // producing flicker login→app and non-deterministic session visibility.
  const authGenRef = useRef(0);

  useEffect(() => { loadingRef.current = loading; }, [loading]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const revokeDisabledSession = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    if (mountedRef.current) {
      setUser(null);
      setError(DISABLED_ACCOUNT_MESSAGE);
      setLoading(false);
    }
  }, []);

  const applyAuthenticatedUser = useCallback(async (
    supabaseUser: { id: string; email?: string; created_at?: string },
    gen: number,
  ): Promise<boolean> => {
    const profile = await _fetchProfile(supabaseUser.id);
    if (gen !== authGenRef.current || !mountedRef.current) return false;
    if (profile?.isDisabled) {
      await revokeDisabledSession();
      return false;
    }
    setUser(_mapUser(supabaseUser, profile));
    setLoading(false);
    return true;
  }, [revokeDisabledSession]);

  const refreshUser = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const gen = ++authGenRef.current;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (gen !== authGenRef.current) return; // a newer check wins
      if (!session) {
        if (mountedRef.current) { setUser(null); setLoading(false); }
        return;
      }
      await applyAuthenticatedUser(session.user, gen);
    } catch (err) {
      console.warn('[auth] refreshUser error:', err);
      if (gen === authGenRef.current && mountedRef.current) {
        setUser(null);
        setLoading(false);
      }
    }
  }, [applyAuthenticatedUser]);

  useEffect(() => {
    refreshUser();
    // Safety timeout: if Supabase is slow, show login UI after 5s — but do NOT
    // bump authGenRef. Invalidating the generation discarded a late valid
    // getSession() result and left users stuck on the login screen.
    const timeout = setTimeout(() => {
      if (mountedRef.current && loadingRef.current) {
        console.warn('[auth] Session check timed out, showing login screen');
        setLoading(false);
      }
    }, 5000);
    if (!supabase) { clearTimeout(timeout); return; }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mountedRef.current) return;
      if (!session) {
        const gen = ++authGenRef.current;
        setUser(null);
        if (gen === authGenRef.current) setLoading(false);
        return;
      }
      // Treat onAuthStateChange as the latest authority: bump the generation
      // so any in-flight refreshUser gives up before touching state, then
      // flip loading back to true while we fetch the profile (otherwise the
      // user appears without a loading gate and the app flickers).
      const gen = ++authGenRef.current;
      setLoading(true);
      applyAuthenticatedUser(session.user, gen).catch((err) => {
        console.warn('[auth] onAuthStateChange profile fetch failed:', err);
        if (mountedRef.current && gen === authGenRef.current) {
          setUser(null);
          setLoading(false);
        }
      });
    });
    return () => { clearTimeout(timeout); subscription.unsubscribe(); };
  }, [refreshUser, applyAuthenticatedUser]);

  // Immediate logout when an admin flips is_disabled on this user's profile.
  useEffect(() => {
    if (!supabase || !user?.id) return;
    const userId = user.id;
    const channel = supabase
      .channel(`user-profile:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_profiles',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as { is_disabled?: boolean } | null;
          if (next?.is_disabled) {
            void revokeDisabledSession();
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, revokeDisabledSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: 'Supabase no configurado' };
    const { data, error: sbError } = await supabase.auth.signInWithPassword({ email, password });
    if (sbError) {
      setError(sbError.message);
      return { error: sbError.message };
    }
    const userId = data.user?.id;
    if (userId) {
      const profile = await _fetchProfile(userId);
      if (profile?.isDisabled) {
        await revokeDisabledSession();
        return { error: DISABLED_ACCOUNT_MESSAGE };
      }
    }
    setError(null);
    return { error: null };
  }, [revokeDisabledSession]);

  const signUp = useCallback(async (_email: string, _password: string) => {
    const message = 'Registro deshabilitado. Solicita una invitación a un administrador.';
    setError(message);
    return { error: message };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    if (mountedRef.current) {
      setUser(null);
      setError(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, signIn, signUp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
