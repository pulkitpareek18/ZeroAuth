import type { RequestHandler } from 'express';

/**
 * Host-aware gate that runs after API mounts but before the static
 * handlers (landing, dashboard SPA, Docusaurus).
 *
 * Purpose: stop the Express landing-page catch-all from being served on
 * subdomains where it does not belong.
 *
 * On `api.zeroauth.dev` the only valid surface is the JSON API. The
 * root path returns a tiny self-description so curl / browser hits
 * land somewhere useful, and any other unmatched path returns a JSON
 * 404 instead of falling through to /public/index.html. Without this,
 * api.zeroauth.dev/ rendered the marketing site, which is confusing
 * for developers expecting an API host.
 *
 * If a request reaches this middleware on an api.* host it means none
 * of the API routes (mounted earlier) matched — so it's either a
 * typo, a probe, or the root.
 */
export const hostRouter: RequestHandler = (req, res, next) => {
  const host = (req.headers.host ?? '').toLowerCase().split(':')[0];

  if (host.startsWith('api.')) {
    if (req.path === '/' || req.path === '') {
      res.json({
        name: 'ZeroAuth API',
        version: '1.0.0',
        docs: 'https://docs.zeroauth.dev',
        console: 'https://console.zeroauth.dev',
        health: 'https://api.zeroauth.dev/api/health',
      });
      return;
    }
    res.status(404).json({
      error: 'not_found',
      message: `No route for ${req.method} ${req.path} on the API host. See https://docs.zeroauth.dev.`,
    });
    return;
  }

  next();
};
