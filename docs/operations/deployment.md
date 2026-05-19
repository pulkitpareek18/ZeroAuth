# Deployment

ZeroAuth now supports a proper GitHub Actions based deployment flow for `zeroauth.dev`.

## Current Production Topology

Production runs on a VPS at `104.207.143.14` with:

- `zeroauth-prod` for the Node.js API and static assets
- `zeroauth-caddy` for HTTPS termination and reverse proxy
- `zeroauth-postgres` for tenant, API-key, usage, and central API data
- `zeroauth-redis` for Redis-backed runtime support

All services are orchestrated with Docker Compose in `/opt/zeroauth`.

## CI Workflow

Workflow file: `.github/workflows/ci.yml`

Triggered on:

- pull requests
- pushes to non-`main` branches

What it does:

1. installs root, dashboard, and docs dependencies
2. runs `npm test`
3. runs `npm run build:all`

This is the branch protection layer.

## CD Workflow

Workflow file: `.github/workflows/deploy.yml`

Triggered on:

- pushes to `main`
- manual `workflow_dispatch`

What it does:

1. re-runs tests and builds on GitHub Actions
2. opens an SSH session with the deploy key
3. rsyncs the repository to `/opt/zeroauth`
4. runs `scripts/deploy-remote.sh`
5. validates container health and the public `/api/health` endpoint

## Required GitHub Secret

Add this repository secret:

- `DEPLOY_SSH_KEY`

The private key for the VPS deploy user is expected here. The workflow uses:

- host: `104.207.143.14`
- user: `zeroauth-deploy`
- path: `/opt/zeroauth`

## Server-Side Deploy User

The server should deploy through a dedicated SSH user, not a root password.

Configured deploy user:

- `zeroauth-deploy`

Expected capabilities:

- member of the `docker` group
- write access to `/opt/zeroauth`
- SSH key in `~/.ssh/authorized_keys`

## Remote Deploy Script

Script file: `scripts/deploy-remote.sh`

The remote script:

1. validates Docker Compose config
2. runs `docker compose --profile prod up -d --build --remove-orphans`
3. waits for `zeroauth-prod` to become healthy
4. calls `https://api.zeroauth.dev/api/health`
5. prunes dangling Docker images

## Important Build Detail

The production Docker image is now self-contained:

- backend compiled inside Docker
- dashboard built inside Docker
- Docusaurus docs built inside Docker

That means deploys no longer depend on someone manually prebuilding `website/build` on a laptop before syncing files to the server.

## First-Time Setup Checklist

1. Add `DEPLOY_SSH_KEY` to GitHub repository secrets.
2. Ensure `/opt/zeroauth/.env` exists on the VPS and is not overwritten by CI/CD.
3. Push to `main` or trigger the Deploy workflow manually.
4. Verify [https://api.zeroauth.dev/api/health](https://api.zeroauth.dev/api/health).

## Recommended Hardening

- disable password SSH login once the deploy key path is confirmed
- disable direct root SSH login and keep root for break-glass only
- rotate any secret that was ever stored in-repo or shared insecurely
- add branch protection so `main` only deploys after passing CI
