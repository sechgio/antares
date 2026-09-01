import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Trash2, ShieldCheck, ShieldOff, Ban, CheckCircle, Loader2, Mail, Search, Lock, Eye, EyeOff } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../hooks/useToast';

type AdminUser = {
  user_id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  is_disabled: boolean;
  created_at: string;
  last_sign_in_at: string | null;
};

type UserRole = 'user' | 'admin';

const MIN_PASSWORD_LENGTH = 8;

/** Admin gate is UX-only; RLS, RPCs, and edge functions enforce real authorization. */
export default function PanelView() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const { addToast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_list_users');
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setUsers((data as AdminUser[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (currentUser?.isAdmin) loadUsers();
    else setLoading(false);
  }, [currentUser, loadUsers]);

  const resetCreateForm = useCallback(() => {
    setNewEmail('');
    setNewPassword('');
    setConfirmPassword('');
    setNewRole('user');
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, []);

  const handleCreateUser = useCallback(async () => {
    if (!supabase) return;

    const email = newEmail.trim().toLowerCase();
    if (!email) return;

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      addToast({ message: t('panel.passwordTooShort', { min: MIN_PASSWORD_LENGTH }), type: 'error' });
      return;
    }
    if (newPassword !== confirmPassword) {
      addToast({ message: t('panel.passwordMismatch'), type: 'error' });
      return;
    }

    setActionLoading('create');
    const { data, error: createError } = await supabase.functions.invoke('admin-create-user', {
      body: { email, password: newPassword, email_confirm: true, role: newRole },
    });

    if (createError) {
      addToast({ message: createError.message, type: 'error' });
      setActionLoading(null);
      return;
    }

    if (data?.error) {
      addToast({ message: data.error, type: 'error' });
      setActionLoading(null);
      return;
    }

    addToast({ message: t('panel.userCreated'), type: 'success' });
    resetCreateForm();
    await loadUsers();
    setActionLoading(null);
  }, [newEmail, newPassword, confirmPassword, newRole, loadUsers, addToast, t, resetCreateForm]);

  const handleToggleDisabled = useCallback(async (u: AdminUser) => {
    if (!supabase) return;
    setActionLoading(`disable-${u.user_id}`);
    const { error: rpcError } = await supabase.rpc('admin_toggle_disabled', {
      p_user_id: u.user_id,
      p_disabled: !u.is_disabled,
    });
    if (rpcError) {
      addToast({ message: rpcError.message, type: 'error' });
    } else {
      addToast({ message: u.is_disabled ? t('panel.userEnabled') : t('panel.userDisabled'), type: 'success' });
      await loadUsers();
    }
    setActionLoading(null);
  }, [loadUsers, addToast, t]);

  const handleToggleAdmin = useCallback(async (u: AdminUser) => {
    if (!supabase) return;
    setActionLoading(`admin-${u.user_id}`);
    const { error: rpcError } = await supabase.rpc('admin_set_admin', {
      p_user_id: u.user_id,
      p_is_admin: !u.is_admin,
    });
    if (rpcError) {
      addToast({ message: rpcError.message, type: 'error' });
    } else {
      addToast({ message: u.is_admin ? t('panel.adminRemoved') : t('panel.adminGranted'), type: 'success' });
      await loadUsers();
    }
    setActionLoading(null);
  }, [loadUsers, addToast, t]);

  const handleDelete = useCallback(async (u: AdminUser) => {
    if (!supabase) return;
    if (u.user_id === currentUser?.id) {
      addToast({ message: t('panel.cannotDeleteSelf'), type: 'error' });
      return;
    }
    if (!confirm(t('panel.confirmDelete', { email: u.email }))) return;
    setActionLoading(`delete-${u.user_id}`);
    const { data, error: deleteError } = await supabase.functions.invoke('admin-delete-user', {
      body: { user_id: u.user_id },
    });
    const errorMsg = deleteError?.message ?? data?.error;
    if (errorMsg) {
      addToast({ message: errorMsg, type: 'error' });
    } else {
      addToast({ message: t('panel.userDeleted'), type: 'success' });
      await loadUsers();
    }
    setActionLoading(null);
  }, [currentUser, loadUsers, addToast, t]);

  if (!currentUser?.isAdmin) {
    // UX-only gate: real authorization is enforced by Supabase RPCs / edge
    // functions (is_admin + not disabled). This UI check only avoids confusion.
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <ShieldOff size={48} className="mx-auto text-[var(--text-muted)]" />
          <p className="mt-4 text-sm text-[var(--text-muted)]">{t('panel.accessDenied')}</p>
        </div>
      </div>
    );
  }

  const filtered = users.filter((u) =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.display_name ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const canCreateUser =
    newEmail.trim().length > 0 &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    confirmPassword.length >= MIN_PASSWORD_LENGTH;

  const inputClassName =
    'w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]';

  return (
    <div className="flex h-full flex-col p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('panel.title')}</h2>
        <p className="text-xs text-[var(--text-muted)]">{t('panel.subtitle')}</p>
      </header>

      <div className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{t('panel.createUser')}</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative min-w-0">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t('panel.emailPlaceholder')}
              autoComplete="off"
              className={`${inputClassName} pl-9 pr-3`}
            />
          </div>
          <div className="relative min-w-0">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('panel.passwordPlaceholder')}
              autoComplete="new-password"
              className={`${inputClassName} pl-9 pr-9`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label={showPassword ? t('panel.hidePassword') : t('panel.showPassword')}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="relative min-w-0">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('panel.confirmPasswordPlaceholder')}
              autoComplete="new-password"
              className={`${inputClassName} pl-9 pr-9`}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label={showConfirmPassword ? t('panel.hidePassword') : t('panel.showPassword')}
            >
              {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className={`${inputClassName} px-3`}
              aria-label={t('panel.role')}
            >
              <option value="user">{t('panel.roleUser')}</option>
              <option value="admin">{t('panel.roleAdmin')}</option>
            </select>
            <button
              type="button"
              onClick={handleCreateUser}
              disabled={!canCreateUser || actionLoading === 'create'}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-2 text-xs font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-primary-glow)] disabled:opacity-50"
            >
              {actionLoading === 'create' ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              {t('panel.create')}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {t('panel.createUserHint', { min: MIN_PASSWORD_LENGTH })}
        </p>
      </div>

      <div className="mb-3 relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('panel.searchPlaceholder')}
          className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
        />
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-[var(--accent-red)] bg-[color-mix(in_srgb,var(--accent-red)_10%,transparent)] p-4 text-sm text-[var(--accent-red)]">
          {error}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--bg-surface)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">{t('panel.colUser')}</th>
                <th className="px-3 py-2 font-medium">{t('panel.colRole')}</th>
                <th className="px-3 py-2 font-medium">{t('panel.colStatus')}</th>
                <th className="px-3 py-2 font-medium">{t('panel.colLastLogin')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('panel.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.user_id} className="border-t border-[var(--border-subtle)]">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-[var(--text-primary)]">{u.display_name ?? u.email}</div>
                    <div className="text-xs text-[var(--text-muted)]">{u.email}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    {u.is_admin ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)]">
                        <ShieldCheck size={14} /> {t('panel.admin')}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">{t('panel.user')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {u.is_disabled ? (
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-red)]">
                        <Ban size={14} /> {t('panel.disabled')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-green)]">
                        <CheckCircle size={14} /> {t('panel.active')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <WithHoverTooltip label={u.is_admin ? t('panel.removeAdmin') : t('panel.makeAdmin')} placement="bottom">
                        <button
                          type="button"
                          onClick={() => handleToggleAdmin(u)}
                          disabled={u.user_id === currentUser?.id || actionLoading === `admin-${u.user_id}`}
                          aria-label={u.is_admin ? t('panel.removeAdmin') : t('panel.makeAdmin')}
                          className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent-primary)] disabled:opacity-30"
                        >
                          {actionLoading === `admin-${u.user_id}` ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                        </button>
                      </WithHoverTooltip>
                      <WithHoverTooltip label={u.is_disabled ? t('panel.enable') : t('panel.disable')} placement="bottom">
                        <button
                          type="button"
                          onClick={() => handleToggleDisabled(u)}
                          disabled={u.user_id === currentUser?.id || actionLoading === `disable-${u.user_id}`}
                          aria-label={u.is_disabled ? t('panel.enable') : t('panel.disable')}
                          className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent-yellow)] disabled:opacity-30"
                        >
                          {actionLoading === `disable-${u.user_id}` ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                        </button>
                      </WithHoverTooltip>
                      <WithHoverTooltip label={t('panel.delete')} placement="bottom">
                        <button
                          type="button"
                          onClick={() => handleDelete(u)}
                          disabled={u.user_id === currentUser?.id || actionLoading === `delete-${u.user_id}`}
                          aria-label={t('panel.delete')}
                          className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent-red)] disabled:opacity-30"
                        >
                          {actionLoading === `delete-${u.user_id}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                      </WithHoverTooltip>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">
                    {t('panel.noUsers')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
