# Subdomain refactor — Tue 2026-05-19 (engineering log)

> Companion to `2026-05-19.md`. Captures the second batch of work that
> landed on `dev` later in the day.

## What shipped

| Commit | Title |
|---|---|
| `8a4e0a4` | config: add consoleBaseUrl / docsBaseUrl / landingBaseUrl for the subdomain split |
| `d1d6397` | Caddyfile: vhosts for api./console./docs.zeroauth.dev + apex redirects |
| `223ba75` | console: cross-subdomain cookie + post-verify redirect via consoleBaseUrl |
| `85172a8` | landing: rewrite internal links to console./docs./api. subdomains |
| `a686219` | dashboard: docs link reads VITE_DOCS_BASE_URL (defaults to docs.zeroauth.dev) |
| `78340c5` | email-templates: route all links to the new subdomains |
| `f576862` | docs + README: route every URL to the right subdomain |
| `ff3f24d` | docs: interactive API playground at /reference/playground |
| `7b0713b` | tests: realign email assertions to the new subdomain URLs |
| `930fd9c` (governance) | docs: realign URL references to api./console./docs.zeroauth.dev subdomains |

## Subdomain split shape

| Hostname | Serves |
|---|---|
| `zeroauth.dev` | Marketing landing + apex 308s for legacy `/v1`, `/api`, `/dashboard`, `/docs` paths |
| `api.zeroauth.dev` | REST surface (`/v1/*`, `/api/*`) — non-API paths return 404 |
| `console.zeroauth.dev` | Developer console (Vite SPA) — `/` rewrites to upstream `/dashboard/` |
| `docs.zeroauth.dev` | Docusaurus build — `/` rewrites to upstream `/docs/` |

All five hostnames terminate at the same Caddy instance and proxy to
`zeroauth-prod:3000`. The split is purely at the edge.

## DNS prerequisites (operator action)

Before deploy, add A records pointing the three new subdomains at
`104.207.143.14`:

```
A     api.zeroauth.dev      → 104.207.143.14
A     console.zeroauth.dev  → 104.207.143.14
A     docs.zeroauth.dev     → 104.207.143.14
```

Caddy provisions Let's Encrypt certs automatically on first request.

## API playground

`docs/reference/playground.mdx` mounts a new `<ApiPlayground />` React
component. Reader pastes their API key, picks an endpoint from a
catalogue (health / nonce / circuit-info / register / verify /
devices / audit), edits the request body, hits Send. Response status,
body, and round-trip time render underneath.

The key never leaves the browser — the request goes directly from the
docs page to `api.zeroauth.dev`. To add new endpoints: append to the
`ENDPOINTS` array in `website/src/components/ApiPlayground/index.tsx`.

## Tests

- Backend: **234/234 jest pass**.
- Dashboard: `tsc --noEmit` clean.
- Docusaurus: `npm --prefix website run build` succeeds end-to-end.

## Still pending

1. **DNS records** (operator) — see above.
2. **Cloudflare decision** — keep current CF on apex / route new
   subdomains direct to VPS, or move everything behind CF. Deferred.
3. **PR `dev → main`** — drafted at the end of this cycle once the
   DNS records are live and `api.zeroauth.dev/api/health` returns 200.

---

LAST_UPDATED: 2026-05-19
