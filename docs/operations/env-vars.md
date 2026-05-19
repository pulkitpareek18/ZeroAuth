# Operations — Environment variables

How to add, change, rotate, or audit env vars on the ZeroAuth production VPS.

> **Status:** *Manual today, automation planned.* The current procedure is "SSH to the VPS, edit `/opt/zeroauth/.env`, recreate the container." This is friction at every change. The GitHub-Actions-managed `PROD_ENV_FILE` path documented at the bottom of this file (§ "The plan to retire manual env editing") removes that friction; ship it when the next env change needs to happen, not before.

---

## Where env vars actually live

| Location | What it holds | Who edits it |
|---|---|---|
| `/opt/zeroauth/.env` on the VPS (`104.207.143.14`) | The authoritative production env — everything the running Docker container reads via `docker-compose.yml`'s `env_file:` directive | Manually, by SSH, **today**. Future: written by the deploy workflow from a GitHub secret. |
| `~/Desktop/ZeroAuth/.env` on the dev machine | Local dev env — used by `tsx watch src/server.ts` and the local `docker compose --profile dev` | Engineer, by hand. Gitignored. |
| `~/Desktop/ZeroAuth/.env.production.snapshot` | A copy of the production `.env` saved locally for reference + audit. Updated whenever the production env changes via the procedure in this runbook. | This file is rewritten by the procedure below. Gitignored. |
| `~/Desktop/ZeroAuth/.env.production.snapshot.<UTC-timestamp>` | Archival copies — one per change. Never overwritten. Useful for `diff` against current to see what changed and when. | Created by the procedure below. Gitignored. |
| `.env.example` (in repo) | Documented placeholder for every env var the codebase reads. NO real values. Source-of-truth for what to set when standing up a new environment. | Engineer, in a PR alongside any code that reads a new env var. |

`/opt/zeroauth/.env` is the only file the running container actually reads. Everything else is local convenience. They must not drift, which is the problem this runbook addresses.

---

## The single most important gotcha

**`docker compose restart` does NOT reload `env_file` changes.** It stops and starts the existing container with its existing env. To pick up edits to `/opt/zeroauth/.env`, you MUST use:

```bash
docker compose --profile prod up -d --force-recreate zeroauth-prod
```

`up -d` recreates the container if the compose definition or its source files have changed. `--force-recreate` removes any doubt. This is the only command that picks up new env vars.

If you `restart` instead, the change appears to be live (no errors), but the new env vars are absent from the container's `process.env`. Symptoms: `sendMail()` says "SMTP not configured" even though the `.env` has SMTP_HOST set; tenant resolution silently falls back; etc.

---

## Procedure — add or change one or more env vars

### Step 1 — Snapshot

Before any edit, snapshot the current state to a timestamped archival copy locally AND a backup on the VPS.

From the dev machine (replace `${HOST}` etc. via your SSH config or just hardcode):

```bash
HOST=104.207.143.14
USER=zeroauth-deploy   # preferred; key-based. Use root only if zeroauth-deploy isn't available.
REMOTE_ENV=/opt/zeroauth/.env
TS=$(date -u +%Y%m%dT%H%M%SZ)

# Local archival copy
scp "${USER}@${HOST}:${REMOTE_ENV}" "${HOME}/Desktop/ZeroAuth/.env.production.snapshot.${TS}"
cp "${HOME}/Desktop/ZeroAuth/.env.production.snapshot.${TS}" "${HOME}/Desktop/ZeroAuth/.env.production.snapshot"
chmod 600 "${HOME}/Desktop/ZeroAuth/.env.production.snapshot"*

# Remote backup
ssh "${USER}@${HOST}" "cp -p ${REMOTE_ENV} ${REMOTE_ENV}.bak.${TS}"
```

### Step 2 — Edit `/opt/zeroauth/.env`

Two ways. Pick the one that fits the change.

**Append a new block (cleanest for adding):**

```bash
ssh "${USER}@${HOST}" "cat >> ${REMOTE_ENV}" <<'EOF'

# ── New section description (added YYYY-MM-DD) ─────────
KEY1=value1
KEY2=value2
EOF
```

**Edit in place (for changing an existing value):**

```bash
ssh "${USER}@${HOST}" -t "nano ${REMOTE_ENV}"
```

After either, verify ownership + perms:

```bash
ssh "${USER}@${HOST}" "chown zeroauth-deploy:zeroauth-deploy ${REMOTE_ENV} && chmod 600 ${REMOTE_ENV} && wc -l ${REMOTE_ENV}"
```

### Step 3 — Force-recreate the prod container

```bash
ssh "${USER}@${HOST}" "cd /opt/zeroauth && docker compose --profile prod up -d --force-recreate zeroauth-prod"
```

Takes ~10 seconds. Caddy continues serving during the swap; brief 502s are possible.

### Step 4 — Verify the new env is actually in the container

```bash
ssh "${USER}@${HOST}" \
  "docker exec zeroauth-prod sh -c 'env | grep -E ^KEY1=' | sed 's/=.*\\(.\\{4\\}\\)$/=<...\\1>/'"
```

The `sed` trick truncates secrets to the last 4 chars so they're identifiable in output without being fully revealed.

### Step 5 — Smoke the dependent feature

Some examples by feature:

| Feature | Smoke |
|---|---|
| SMTP env added | `curl -X POST https://api.zeroauth.dev/api/console/signup -d '{"email":"smoke+<ts>@yushuexcellence.in","password":"Smoke2026!Pass"}'` → check logs for `Email: sent` with a messageId |
| Database creds changed | `curl https://api.zeroauth.dev/api/health` returns `{"status":"healthy"}` and `subsystems.postgres` is `connected` |
| Blockchain wallet rotated | `curl https://api.zeroauth.dev/api/health` returns `{"subsystems":{"blockchain":{"status":"connected","chainId":84532}}}` |
| JWT secret rotated | Existing console sessions break (expected). Re-login from `/dashboard/login` works. |

Tail the logs while you smoke:

```bash
ssh "${USER}@${HOST}" "docker logs zeroauth-prod --since 1m 2>&1 | tail -50"
```

### Step 6 — Sync the local snapshot

After you've verified production works, pull the updated `.env` back to your local snapshot so it matches what's now on the VPS:

```bash
scp "${USER}@${HOST}:${REMOTE_ENV}" "${HOME}/Desktop/ZeroAuth/.env.production.snapshot"
chmod 600 "${HOME}/Desktop/ZeroAuth/.env.production.snapshot"
```

Diff the new snapshot against the previous archival copy to see exactly what changed:

```bash
diff "${HOME}/Desktop/ZeroAuth/.env.production.snapshot.${TS}" "${HOME}/Desktop/ZeroAuth/.env.production.snapshot"
```

---

## Procedure — rotate a secret

Same as the change procedure above. Two notes:

1. **Long-lived clients survive a rotation transparently in some cases, not others.** API keys (`za_live_...`) are server-issued and never live in `/opt/zeroauth/.env`, so an SMTP/DB/blockchain rotation doesn't affect them. The JWT secret IS in the env — rotating it invalidates every active console session (the dashboard logs everyone out). That's the right behavior on a suspected compromise; not the right behavior for routine maintenance.
2. **The new value goes on the VPS BEFORE the old value gets revoked at the provider.** Otherwise you hit a window where the running container still uses the old (now-revoked) value. Order: (a) provider dashboard issues new value, (b) you edit `/opt/zeroauth/.env` + force-recreate container, (c) verify the new value works, (d) revoke the old value at the provider.

---

## Specific operational pre-reqs by service

### Brevo SMTP (per ADR-0005)

- Authorized IPs allowlist must include the sending IP. Brevo dashboard → top-right account name → **Senders, Domains & Dedicated IPs → Authorized IPs**.
- For production: `104.207.143.14`
- For local dev (if you want to send mail from your laptop): add your current public IP
- Without this, every SMTP login returns `525 5.7.1 Unauthorized IP address` and `sendMail()` returns `{ok:false, error:'5.7.1 Unauthorized IP'}`. The service still runs; emails just don't deliver.

### DNS records for inbox delivery

On the `zeroauth.dev` DNS (Hostinger panel), add these three TXT records once. Without them, Brevo-sent mail may land in spam:

- **SPF** — name `@`, value `v=spf1 include:spf.brevo.com ~all`
- **DKIM** — name `mail._domainkey`, value from Brevo dashboard (Settings → Senders & IPs → Domains → click your domain → DKIM record)
- **DMARC** — name `_dmarc`, value `v=DMARC1; p=quarantine; rua=mailto:dmarc@zeroauth.dev`

### Postgres

`POSTGRES_PASSWORD` rotation: bring up a new password via a `ALTER USER zeroauth WITH PASSWORD '<new>'` while the old password is still valid, update `.env`, force-recreate. Don't bounce the DB; the new password is accepted by Postgres immediately on the next connection.

### Blockchain deployer wallet (`BLOCKCHAIN_PRIVATE_KEY`)

Rotating the deployer key requires also calling `transferOwnership` on the `DIDRegistry` contract from the OLD wallet to the NEW one. There's a `scripts/transfer-ownership.ts` for this. Order:

1. Generate new wallet (cast new EOA or hardware-backed key)
2. Run `npm run wallet:rotate` locally with `BLOCKCHAIN_PRIVATE_KEY=<old>` and `NEW_OWNER=<new-address>` env. This calls `transferOwnership(<new-address>)`.
3. Confirm on-chain (Base Sepolia block explorer)
4. Update `/opt/zeroauth/.env` with the new private key
5. Force-recreate container
6. Verify `/api/health` reports blockchain connected
7. Wipe the old private key from anywhere it might still live

---

## Procedure — emergency rollback

If a deploy or env change broke production:

```bash
# Roll back to the previous /opt/zeroauth/.env.bak.<timestamp> backup
ssh root@104.207.143.14
ls -lt /opt/zeroauth/.env.bak.*  # find the most recent backup
cp /opt/zeroauth/.env.bak.<TIMESTAMP> /opt/zeroauth/.env
chown zeroauth-deploy:zeroauth-deploy /opt/zeroauth/.env
chmod 600 /opt/zeroauth/.env
cd /opt/zeroauth && docker compose --profile prod up -d --force-recreate zeroauth-prod
```

Verify with `/api/health`. Total time: ~30 seconds.

`.env.bak.*` files are intentionally never auto-cleaned — they're the rollback parachute. Sweep them manually once a quarter when the backup tree exceeds 20 entries.

---

## Procedure — full local re-creation of `/opt/zeroauth/.env`

If the VPS `.env` is lost or corrupted entirely:

```bash
# From the dev machine, push the local snapshot back
scp "${HOME}/Desktop/ZeroAuth/.env.production.snapshot" \
    "root@104.207.143.14:/opt/zeroauth/.env"
ssh root@104.207.143.14 \
    "chown zeroauth-deploy:zeroauth-deploy /opt/zeroauth/.env && \
     chmod 600 /opt/zeroauth/.env && \
     cd /opt/zeroauth && docker compose --profile prod up -d --force-recreate zeroauth-prod"
```

This is why the local snapshot exists. Keep it up to date after every change (Step 6 above).

---

## The plan to retire manual env editing

When the next env change is needed, **ship this PR instead of doing another manual edit:**

1. **Update `.github/workflows/deploy.yml`** — add a step:

   ```yaml
   - name: Write /opt/zeroauth/.env from PROD_ENV_FILE secret
     if: env.PROD_ENV_FILE != ''
     env:
       PROD_ENV_FILE: ${{ secrets.PROD_ENV_FILE }}
     run: |
       echo "$PROD_ENV_FILE" | ssh "$DEPLOY_USER@$DEPLOY_HOST" \
         "cat > $DEPLOY_PATH/.env.new && \
          chown zeroauth-deploy:zeroauth-deploy $DEPLOY_PATH/.env.new && \
          chmod 600 $DEPLOY_PATH/.env.new && \
          mv $DEPLOY_PATH/.env.new $DEPLOY_PATH/.env"
   ```

2. **In GitHub → Settings → Secrets and variables → Actions → New repository secret:**
   - Name: `PROD_ENV_FILE`
   - Value: paste the entire contents of the current `/opt/zeroauth/.env`

3. **From then on, env changes look like:**
   - GitHub Settings → Secrets → edit `PROD_ENV_FILE` → "Update"
   - GitHub Actions → Deploy workflow → "Run workflow" → main
   - ~30 seconds. No SSH. Full audit log in GitHub.

4. **The `if: env.PROD_ENV_FILE != ''` guard means the current manual flow keeps working** until you opt in by creating the secret. There's no flip-day.

5. **Adding a new env var becomes:**
   - Edit `PROD_ENV_FILE` in the GitHub UI, add a new line, save
   - Trigger the Deploy workflow manually
   - Done. No SSH, no `--force-recreate` to remember.

This is documented per ADR-pending (`adr-0007-github-actions-managed-prod-env.md` once it lands).

---

## Audit log

Every change to production env vars should be reflected in two places:

1. **A line in this section** at the bottom of the file, with the date, who, what changed (key names only, not values), and the rationale
2. **A commit to the repo** that updates `.env.example` if a new key was added (the schema), even if the value lives only on the VPS

### Recent changes

| Date (UTC) | Operator | Keys changed | Rationale |
|---|---|---|---|
| 2026-05-15 06:19 | Pulkit + Claude | Added `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | Issue #27 F-2 partial mitigation. Brevo SMTP via nodemailer per ADR-0005. Welcome email + signup-attempted-notice email on console signup. |

---

LAST_UPDATED: 2026-05-15
OWNER: Pulkit Pareek
