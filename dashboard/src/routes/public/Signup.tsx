import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { ApiError } from '../../lib/api';
import { Button, Input, Label } from '../../components/ui';
import { AuthLayout } from './Login';

/**
 * F-2 v2 signup (issue #27).
 *
 * POST /api/console/signup is now an email-verify gate — it always returns
 * 202 + { status: 'pending_verification', message } whether the email is
 * fresh or already taken. The actual tenant + API key are minted only
 * after the user clicks the verification link, which lands on
 * /dashboard/signup-complete where the key is revealed once.
 *
 * This page therefore has two states:
 *   1. The form (collects email + password + company)
 *   2. The "check your inbox" confirmation (shown after a successful submit)
 *
 * We deliberately do NOT distinguish "email taken" from "email fresh" in
 * the UI — that would re-create the enumeration vector the backend just
 * closed.
 */
export function Signup() {
  const { status, signup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (status === 'authenticated' && !sentTo) {
    return <Navigate to="/overview" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const trimmed = email.trim();
    try {
      await signup({
        email: trimmed,
        password,
        companyName: companyName.trim() || undefined,
      });
      setSentTo(trimmed);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Sign-up failed.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle={`We sent a verification link to ${sentTo}. Click it to finish setting up your account — the link expires in 24 hours.`}
      >
        <div className="space-y-4">
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
            <p className="mb-2 text-[var(--color-text)]">What happens next</p>
            <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed">
              <li>Open the email titled <em>"Verify your ZeroAuth account"</em>.</li>
              <li>Click <em>"Verify and continue"</em> — it lands you on the dashboard.</li>
              <li>Your first API key is revealed once on the next screen. Save it before navigating away.</li>
            </ol>
          </div>

          <p className="text-xs text-[var(--color-text-dim)]">
            No email yet? Check your spam folder, then try again with the same address.
            We never indicate whether an address is already registered — that's a deliberate
            anti-enumeration choice.
          </p>

          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setSentTo(null);
              setPassword('');
            }}
          >
            Use a different email
          </Button>

          <div className="text-center text-xs text-[var(--color-text-secondary)]">
            Already verified?{' '}
            <Link to="/login" className="font-medium text-[var(--color-brand)] hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" subtitle="Sign up to start issuing API keys, registering devices, and verifying identities.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="email">Work email</Label>
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
          <Label htmlFor="company">Company name (optional)</Label>
          <Input
            id="company"
            type="text"
            autoComplete="organization"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Acme Corp"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mt-1.5 text-[11px] text-[var(--color-text-dim)]">
            At least 12 characters, with a letter and a digit. No common passwords.
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        ) : null}

        <Button type="submit" loading={busy} className="w-full" size="lg">
          {busy ? 'Sending verification…' : 'Create account'}
        </Button>

        <p className="text-[11px] text-[var(--color-text-dim)] leading-relaxed">
          We'll email you a one-click verification link. Your account isn't created until you confirm.
        </p>

        <div className="text-center text-xs text-[var(--color-text-secondary)]">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-[var(--color-brand)] hover:underline">
            Sign in
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
