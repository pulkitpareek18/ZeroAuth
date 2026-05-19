import React, { useState, useMemo } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import styles from './styles.module.css';

/**
 * Interactive API tester for the docs site.
 *
 * Lets a reader paste their `za_live_…` or `za_test_…` key, pick an
 * endpoint from the catalogue below, edit the request body, and hit
 * Send. Response status + body + timing render below. Designed for
 * the reference page; never auto-fires, never persists the key.
 *
 * Endpoints surfaced here mirror the public REST surface in
 * docs/reference/api-reference.md. Add new ones by appending to the
 * ENDPOINTS array — no other change needed.
 */

interface EndpointSpec {
  id: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  label: string;
  description: string;
  /** Default body shown in the editor. Null = no body (GET / DELETE). */
  defaultBody: string | null;
  /** True if this endpoint uses the admin x-api-key header instead of Bearer. */
  admin?: boolean;
}

const ENDPOINTS: EndpointSpec[] = [
  {
    id: 'health',
    method: 'GET',
    path: '/api/health',
    label: 'Health check',
    description: 'Unauthenticated. Pings every subsystem and returns a JSON status report.',
    defaultBody: null,
  },
  {
    id: 'nonce',
    method: 'GET',
    path: '/v1/auth/zkp/nonce',
    label: 'Fetch a ZKP nonce',
    description: 'Replay-defence nonce for the verify endpoint. Bind it into the proof, then submit.',
    defaultBody: null,
  },
  {
    id: 'circuit-info',
    method: 'GET',
    path: '/v1/auth/zkp/circuit-info',
    label: 'Circuit metadata',
    description: 'Curve + protocol descriptor for the client-side snarkjs runner.',
    defaultBody: null,
  },
  {
    id: 'register',
    method: 'POST',
    path: '/v1/users/register',
    label: 'Register a user',
    description: 'Bind an external_id to a Poseidon commitment. The biometric never leaves the client.',
    defaultBody: JSON.stringify(
      {
        external_id: 'user_42',
        commitment: '0x1f3c…',
      },
      null,
      2,
    ),
  },
  {
    id: 'verify',
    method: 'POST',
    path: '/v1/verifications',
    label: 'Verify a Groth16 proof',
    description: 'Submit the proof + public signals returned by snarkjs. Server verifies and returns a principal.',
    defaultBody: JSON.stringify(
      {
        external_id: 'user_42',
        proof: { a: ['…'], b: [['…']], c: ['…'] },
        public_signals: ['0x1f3c…'],
      },
      null,
      2,
    ),
  },
  {
    id: 'devices-list',
    method: 'GET',
    path: '/v1/devices',
    label: 'List devices',
    description: 'Tenant + environment scoped.',
    defaultBody: null,
  },
  {
    id: 'audit-list',
    method: 'GET',
    path: '/v1/audit',
    label: 'Audit log (tail)',
    description: 'Most-recent audit events for the calling tenant. Append-only on the server side.',
    defaultBody: null,
  },
];

const DEFAULT_BASE_URL =
  typeof window !== 'undefined' && window.location.host.endsWith('zeroauth.dev')
    ? 'https://api.zeroauth.dev'
    : 'https://api.zeroauth.dev';

interface ResponseSnapshot {
  status: number;
  statusText: string;
  durationMs: number;
  bodyText: string;
  contentType: string;
}

function PlaygroundInner(): JSX.Element {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [endpointId, setEndpointId] = useState(ENDPOINTS[0].id);
  const [body, setBody] = useState<string>(ENDPOINTS[0].defaultBody ?? '');
  const [response, setResponse] = useState<ResponseSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = useMemo(() => ENDPOINTS.find((e) => e.id === endpointId)!, [endpointId]);

  function selectEndpoint(id: string): void {
    const next = ENDPOINTS.find((e) => e.id === id);
    if (!next) return;
    setEndpointId(id);
    setBody(next.defaultBody ?? '');
    setResponse(null);
    setError(null);
  }

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    setResponse(null);
    const url = `${baseUrl.replace(/\/$/, '')}${endpoint.path}`;
    const headers: Record<string, string> = {};
    if (endpoint.method === 'POST') headers['Content-Type'] = 'application/json';
    if (apiKey) {
      if (endpoint.admin) headers['x-api-key'] = apiKey;
      else headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const init: RequestInit = { method: endpoint.method, headers };
    if (endpoint.method === 'POST') init.body = body || '{}';

    const t0 = performance.now();
    try {
      const res = await fetch(url, init);
      const text = await res.text();
      setResponse({
        status: res.status,
        statusText: res.statusText,
        durationMs: Math.round(performance.now() - t0),
        bodyText: text,
        contentType: res.headers.get('content-type') ?? '',
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function prettyBody(text: string, contentType: string): string {
    if (!contentType.includes('json')) return text;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  return (
    <div className={styles.playground}>
      <div className={styles.row}>
        <label className={styles.label}>
          API base
          <input
            type="text"
            className={styles.input}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.zeroauth.dev"
          />
        </label>
        <label className={styles.label}>
          API key
          <input
            type="password"
            className={styles.input}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="za_test_… or za_live_…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      <label className={styles.label}>
        Endpoint
        <select
          className={styles.input}
          value={endpointId}
          onChange={(e) => selectEndpoint(e.target.value)}
        >
          {ENDPOINTS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.method} {e.path} — {e.label}
            </option>
          ))}
        </select>
      </label>

      <p className={styles.hint}>{endpoint.description}</p>

      {endpoint.method === 'POST' ? (
        <label className={styles.label}>
          Request body (JSON)
          <textarea
            className={`${styles.input} ${styles.textarea}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(12, Math.max(4, body.split('\n').length))}
            spellCheck={false}
          />
        </label>
      ) : null}

      <div className={styles.actions}>
        <button
          className={styles.send}
          onClick={() => void send()}
          disabled={busy}
          type="button"
        >
          {busy ? 'Sending…' : `Send ${endpoint.method} ${endpoint.path}`}
        </button>
        <span className={styles.privacy}>
          ↳ runs in your browser, your API key never leaves the page.
        </span>
      </div>

      {error ? (
        <div className={`${styles.responseBox} ${styles.responseError}`}>
          <div className={styles.responseMeta}>request failed</div>
          <pre className={styles.responseBody}>{error}</pre>
        </div>
      ) : null}

      {response ? (
        <div
          className={`${styles.responseBox} ${
            response.status >= 200 && response.status < 300
              ? styles.responseOk
              : styles.responseErr
          }`}
        >
          <div className={styles.responseMeta}>
            <strong>
              {response.status} {response.statusText}
            </strong>
            <span>·</span>
            <span>{response.durationMs} ms</span>
            <span>·</span>
            <span>{response.contentType || 'no content-type'}</span>
          </div>
          <pre className={styles.responseBody}>
            {prettyBody(response.bodyText, response.contentType)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export default function ApiPlayground(): JSX.Element {
  // SSR: render a placeholder so Docusaurus's static build doesn't choke on
  // `window`. The real interactive surface mounts client-side via BrowserOnly.
  return (
    <BrowserOnly fallback={<div className={styles.placeholder}>Loading API playground…</div>}>
      {() => <PlaygroundInner />}
    </BrowserOnly>
  );
}
