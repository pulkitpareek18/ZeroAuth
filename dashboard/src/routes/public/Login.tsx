import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { ApiError } from '../../lib/api';
import { Button, Input, Label } from '../../components/ui';

export function Login() {
  const { status, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set by GET /api/console/verify-signup when a verify link is clicked twice
  // (the account was already created by the first click). Tells the user
  // they're past signup and just need to sign in.
  const alreadyVerified = searchParams.get('already_verified') === '1';

  if (status === 'authenticated') {
    const redirectTo = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/overview';
    return <Navigate to={redirectTo} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate('/overview', { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Login failed.';
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your ZeroAuth developer console.">
      {alreadyVerified ? (
        <div className="mb-4 rounded-md border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 px-3 py-2 text-xs text-[var(--color-success)]">
          Your email is verified. Sign in to continue.
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dev@yourcompany.com"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error ? (
          <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        ) : null}

        <Button type="submit" loading={busy} className="w-full" size="lg">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        <div className="text-center text-xs text-[var(--color-text-secondary)]">
          No account yet?{' '}
          <Link to="/signup" className="font-medium text-[var(--color-brand)] hover:underline">
            Create one
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="grid size-9 place-items-center rounded-md bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-brand-dark)] text-white">
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none">
              <path d="M7.25 7.75H16.75L7.25 16.25H16.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="text-lg font-semibold tracking-tight">ZeroAuth</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-raised)] p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-[var(--color-text)]">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-4 text-center text-xs text-[var(--color-text-dim)]">
          Zero biometric data stored. Ever.
        </p>
      </div>
    </div>
  );
}
