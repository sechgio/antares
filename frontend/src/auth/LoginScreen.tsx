import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
} from 'lucide-react';
import { useAuth } from './AuthContext';
import AntaresScene from './AntaresScene';
import './login.css';

type AppearanceMode = 'dark' | 'light';
const HC_THEME_MODE_KEY = 'hc_theme_mode';
const MOTION_EASE = [0.16, 1, 0.3, 1] as const;

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = (event: MediaQueryListEvent | MediaQueryList) => setReducedMotion(event.matches);
    updatePreference(query);
    query.addEventListener('change', updatePreference);
    return () => query.removeEventListener('change', updatePreference);
  }, []);

  return reducedMotion;
}

function readInitialAppearanceMode(): AppearanceMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(HC_THEME_MODE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* ignore */
  }
  const explicit = document.documentElement.dataset.themeMode;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return 'light';
}

function applyAppearanceMode(mode: AppearanceMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.themeMode = mode;
  root.classList.toggle('theme-light', mode === 'light');
  root.classList.toggle('theme-dark', mode === 'dark');
  try {
    window.localStorage.setItem(HC_THEME_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

const fadeUp = (y: number, delay: number, duration: number) => ({
  initial: { opacity: 0, y },
  animate: { opacity: 1, y: 0 },
  transition: { duration, delay, ease: MOTION_EASE },
});

const videoEnter = {
  initial: { opacity: 0, scale: 1.05 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 1.8, ease: MOTION_EASE },
};

export default function LoginScreen() {
  const { t } = useTranslation();
  const { signIn, error, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(
    () => readInitialAppearanceMode(),
  );
  const reducedMotion = useReducedMotion();
  const displayError = localError ?? error;

  useEffect(() => {
    applyAppearanceMode(appearanceMode);
  }, [appearanceMode]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    if (!email || !password) {
      setLocalError(t('auth.errorEmpty'));
      return;
    }

    if (password.length < 6) {
      setLocalError(t('auth.errorShortPassword'));
      return;
    }

    const result = await signIn(email, password);
    if (result.error) setLocalError(result.error);
  };

  const animate = <P,>(props: P) =>
    reducedMotion ? ({ initial: false } as const) : props;

  return (
    <div data-testid="login-screen" className="at-login">
      <motion.div className="at-login__video" aria-hidden="true" {...animate(videoEnter)}>
        <AntaresScene reducedMotion={reducedMotion} />
      </motion.div>

      <motion.nav className="at-nav" {...animate(fadeUp(-16, 0, 0.8))}>
        <div className="at-nav__left">
          <div className="at-nav__brand">
            <svg className="at-nav__brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="5" width="11" height="11" rx="3" fill="currentColor" transform="rotate(-35 10.5 10.5)" />
              <rect x="8" y="8" width="11" height="11" rx="3" fill="currentColor" transform="rotate(-35 13.5 13.5)" />
            </svg>
            <span className="at-nav__brand-name">Antares</span>
          </div>
        </div>

        <div className="at-nav__right">
          <div className="at-mode-toggle" role="group" aria-label={t('auth.appearanceLabel')}>
            <button
              type="button"
              aria-pressed={appearanceMode === 'dark'}
              onClick={() => setAppearanceMode('dark')}
            >
              {t('auth.modeDark')}
            </button>
            <button
              type="button"
              aria-pressed={appearanceMode === 'light'}
              onClick={() => setAppearanceMode('light')}
            >
              {t('auth.modeLight')}
            </button>
          </div>

        </div>
      </motion.nav>

      <main className="at-access">
        <motion.div className="at-access__card" {...animate(fadeUp(20, 0.8, 0.8))}>
          <div className="at-access__header">
            <h1 className="at-access__title">{t('auth.signInTitle')}</h1>
            <p className="at-access__subtitle">{t('auth.continueMessage')}</p>
          </div>

          <form onSubmit={handleSubmit} className="at-form" noValidate>
            {displayError && (
              <div role="alert" className="at-form__error">
                <AlertCircle size={16} aria-hidden="true" />
                <span>{displayError}</span>
              </div>
            )}

            <div className="at-field">
              <label htmlFor="login-email">{t('auth.email')}</label>
              <div className="at-field__control">
                <Mail size={16} aria-hidden="true" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  required
                />
              </div>
            </div>

            <div className="at-field">
              <label htmlFor="login-password">{t('auth.password')}</label>
              <div className="at-field__control">
                <LockKeyhole size={16} aria-hidden="true" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('auth.passwordPlaceholder')}
                  required
                />
                <button
                  type="button"
                  className="at-field__reveal"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="at-submit" disabled={loading}>
              <span>{loading ? t('auth.working') : t('auth.signIn')}</span>
              <span className="at-submit__icon" aria-hidden="true">
                {loading ? <Loader2 size={16} className="at-spinner" /> : <ArrowRight size={16} />}
              </span>
            </button>
          </form>
        </motion.div>
      </main>

      <motion.footer className="at-login__footer" {...animate(fadeUp(20, 0.5, 1))}>
        <div className="at-login__footer-left">
          <motion.h2 className="at-login__footer-heading" {...animate(fadeUp(20, 0.8, 0.8))}>
            One Day-&gt;
          </motion.h2>
        </div>
      </motion.footer>
    </div>
  );
}
