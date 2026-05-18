import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { setToken, type SignupRevealPayload, type Environment } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, CopyButton, Modal } from '../../components/ui';
import { AuthLayout } from './Login';

const REVEAL_COOKIE = 'zeroauth_signup_reveal';

/**
 * Lands here after the verify-signup endpoint completes (issue #27 F-2 v2).
 *
 * The backend has set a short-lived `zeroauth_signup_reveal` cookie carrying
 * the JWT + the freshly-minted live API key. We:
 *   1. Decode the cookie once
 *   2. Stash the JWT in localStorage so the next refresh hydrates the session
 *   3. Clear the cookie immediately so a back-button or refresh can't re-read
 *   4. Show the API key inside a one-time-reveal modal (same pattern as the
 *      old direct-signup flow used to)
 *
 * If the cookie is missing (link was already used, or user navigated here
 * directly), we route to login with a friendly nudge.
 */
export function SignupComplete() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [payload, setPayload] = useState<SignupRevealPayload | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirmedReveal, setConfirmedReveal] = useState(false);

  useEffect(() => {
    const decoded = readAndClearRevealCookie();
    if (!decoded) {
      setMissing(true);
      return;
    }
    setToken(decoded.token);
    setPayload(decoded);
    // Hydrate auth state in the background — by the time the user closes the
    // modal the global state knows they're authenticated.
    void refresh();
  }, [refresh]);

  if (missing) {
    return <Navigate to="/login?already_verified=1" replace />;
  }

  return (
    <>
      <AuthLayout
        title="Your account is ready"
        subtitle="Save the API key on the next screen — it's revealed once."
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          We're loading your dashboard. If the next screen doesn't open
          automatically, use the link below.
        </p>
        <div className="mt-4">
          <Link to="/overview" className="text-sm font-medium text-[var(--color-brand)] hover:underline">
            Open dashboard
          </Link>
        </div>
      </AuthLayout>

      <Modal
        open={payload !== null}
        onClose={() => { /* keep open until user confirms */ }}
        title="Save your first API key"
        description="This is the only time you'll see it. Treat it like a password."
        footer={
          <Button
            variant="primary"
            disabled={!confirmedReveal}
            onClick={() => {
              setPayload(null);
              navigate('/overview', { replace: true });
            }}
          >
            I've saved it, take me to the console
          </Button>
        }
      >
        {payload ? (
          <div className="space-y-3">
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 font-mono text-xs break-all">
              {payload.apiKey}
            </div>
            <div className="flex justify-end">
              <CopyButton value={payload.apiKey} label="Copy key" />
            </div>
            <div className="rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-3 py-2 text-xs text-[var(--color-warn)]">
              ⚠ Copy this API key now — it will never be shown again.
            </div>
            <p className="text-[11px] text-[var(--color-text-dim)] leading-relaxed">
              Prefix <code>{payload.apiKeyPrefix}</code> · environment{' '}
              <code>{payload.apiKeyEnv satisfies Environment}</code>. You can
              rotate it any time from the API Keys page.
            </p>
            <label className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={confirmedReveal}
                onChange={(e) => setConfirmedReveal(e.target.checked)}
              />
              <span>I have saved this key in a secure location. I understand it cannot be recovered.</span>
            </label>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/**
 * Read the base64url-encoded reveal payload from the `zeroauth_signup_reveal`
 * cookie set by GET /api/console/verify-signup. Returns null if absent or
 * malformed. Always clears the cookie before returning to keep it single-use.
 */
function readAndClearRevealCookie(): SignupRevealPayload | null {
  const raw = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(REVEAL_COOKIE + '='));

  // Clear immediately regardless — we treat the cookie as one-shot. If decoding
  // fails the user gets routed to login anyway.
  document.cookie = `${REVEAL_COOKIE}=; path=/dashboard; max-age=0`;

  if (!raw) return null;

  const value = raw.slice(REVEAL_COOKIE.length + 1);
  if (!value) return null;

  try {
    // base64url → utf8 JSON
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    const parsed = JSON.parse(json) as SignupRevealPayload;
    if (!parsed.token || !parsed.apiKey) return null;
    return parsed;
  } catch {
    return null;
  }
}
