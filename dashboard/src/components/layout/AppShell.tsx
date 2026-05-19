import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useTheme, useBrandMarkUrl, type ThemeChoice } from '../../lib/theme';
import { cn } from '../../lib/cn';
import { Button } from '../ui';
import type { Environment } from '../../lib/api';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

// ─── Environment switcher (shared across data pages) ──────────────

interface EnvCtx {
  environment: Environment;
  setEnvironment: (env: Environment) => void;
}

const EnvContext = createContext<EnvCtx | null>(null);

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [environment, setEnvironment] = useState<Environment>(() => {
    try {
      const stored = localStorage.getItem('zeroauth.env') as Environment | null;
      return stored === 'test' ? 'test' : 'live';
    } catch {
      return 'live';
    }
  });

  const value = useMemo<EnvCtx>(() => ({
    environment,
    setEnvironment: (env) => {
      setEnvironment(env);
      try { localStorage.setItem('zeroauth.env', env); } catch { /* noop */ }
    },
  }), [environment]);

  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
}

export function useEnvironment(): EnvCtx {
  const ctx = useContext(EnvContext);
  if (!ctx) throw new Error('useEnvironment must be used inside <EnvironmentProvider>');
  return ctx;
}

// ─── Nav items ────────────────────────────────────────────────────

const NAV = [
  { to: '/overview', label: 'Overview', icon: 'home' },
  { to: '/api-keys', label: 'API Keys', icon: 'key' },
  { to: '/users', label: 'Users', icon: 'users' },
  { to: '/devices', label: 'Devices', icon: 'cpu' },
  { to: '/verifications', label: 'Verifications', icon: 'shield' },
  { to: '/attendance', label: 'Attendance', icon: 'clock' },
  { to: '/audit', label: 'Audit Log', icon: 'list' },
  { to: '/settings', label: 'Settings', icon: 'gear' },
] as const;

// Inline SVG icons keep the bundle small and the CSP strict.
function Icon({ name, className }: { name: string; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className };
  switch (name) {
    case 'home': return <svg viewBox="0 0 24 24" width={16} height={16} {...common}><path d="m3 11 9-8 9 8"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/></svg>;
    case 'key': return <svg viewBox="0 0 24 24" width={16} height={16} {...common}><circle cx="8" cy="14" r="4"/><path d="m11 11 9-9"/><path d="m17 5 3 3"/></svg>;
    case 'users': return <svg viewBox="0 0 24 24" width={16} height={16} {...common}><circle cx="9" cy="8" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="17" cy="7" r="3"/><path d="M15 21v-1a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v1"/></svg>;
    case 'cpu': return <svg viewBox="0 0 24 24" width={16} height={16} {...common}><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>;
    case 'shield': return <svg viewBox="0 0 24 24" width={16} height={16} {...common}><path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>;
    case 'clock': return <svg viewBox="0 0 24 24" width={16} height={16} {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case 'list': return <svg viewBox="0 0 24 24" width={16} height={16} {...common}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>;
    case 'gear': return <svg viewBox="0 0 24 24" width={16} height={16} {...common}><circle cx="12" cy="12" r="3"/><path d="m19.4 15-1.4-.8.2-1.6-.2-1.6 1.4-.8-2-3.4-1.6.6-1.2-1-.4-1.6h-4l-.4 1.6-1.2 1-1.6-.6-2 3.4 1.4.8.2 1.6-.2 1.6-1.4.8 2 3.4 1.6-.6 1.2 1 .4 1.6h4l.4-1.6 1.2-1 1.6.6z"/></svg>;
    default: return null;
  }
}

// ─── Brand mark — adapts to the active theme ──────────────────────

function BrandMark() {
  const src = useBrandMarkUrl();
  return <img src={src} alt="" aria-hidden="true" className="size-8" />;
}

// ─── Theme toggle — three-segment Light / System / Dark ───────────

function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  const options: Array<{ value: ThemeChoice; label: string; svg: ReactNode }> = [
    {
      value: 'light',
      label: 'Light',
      svg: (
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ),
    },
    {
      value: 'system',
      label: 'Auto',
      svg: (
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      ),
    },
    {
      value: 'dark',
      label: 'Dark',
      svg: (
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ),
    },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="grid grid-cols-3 gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0.5"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={choice === opt.value}
          onClick={() => setChoice(opt.value)}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-sm py-1.5 text-[11px] font-medium transition-colors',
            choice === opt.value
              ? 'bg-[var(--color-bg-raised)] text-[var(--color-text)]'
              : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]',
          )}
        >
          {opt.svg}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Layout ───────────────────────────────────────────────────────

export function AppShell() {
  const { account, logout } = useAuth();
  const { environment, setEnvironment } = useEnvironment();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile sidebar after every navigation.
  useState(() => location.pathname);

  return (
    <div className="flex h-full min-h-screen">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 -translate-x-full border-r border-[var(--color-border)] bg-[var(--color-bg-raised)] transition-transform md:static md:translate-x-0',
          mobileOpen && 'translate-x-0',
        )}
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-[var(--color-border-subtle)] px-4">
          <BrandMark />
          <div>
            <div className="text-[15px] leading-none" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>ZeroAuth</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">Developer console</div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--color-bg-surface)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text)]',
                )
              }
            >
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="absolute inset-x-0 bottom-0 border-t border-[var(--color-border-subtle)] p-3 space-y-2.5">
          <ThemeToggle />
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 text-xs">
            <div className="font-medium text-[var(--color-text)] truncate">{account?.companyName ?? account?.email ?? 'Unknown account'}</div>
            <div className="mt-1 capitalize text-[var(--color-text-dim)]">{account?.plan ?? '—'} plan</div>
          </div>
        </div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />
      ) : null}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="md:hidden inline-flex size-9 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-raised)]"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <div className="hidden md:flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-raised)] p-0.5">
              {(['live', 'test'] as const).map((env) => (
                <button
                  key={env}
                  type="button"
                  onClick={() => setEnvironment(env)}
                  className={cn(
                    'h-7 rounded px-3 text-xs font-medium uppercase tracking-wide transition-colors',
                    environment === env
                      ? 'bg-[var(--color-bg-surface)] text-[var(--color-text)]'
                      : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]',
                  )}
                >
                  {env}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/docs/"
              className="hidden md:inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              target="_blank"
              rel="noopener noreferrer"
            >
              Docs ↗
            </a>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                logout();
                navigate('/login', { replace: true });
              }}
            >
              Sign out
            </Button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
