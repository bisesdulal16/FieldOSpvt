# FieldOS — EC2 production deploy (nginx + Let's Encrypt + CI/CD)

The base `docker-compose.yml` runs the app (Postgres + FastAPI + Next.js dashboard).
`docker-compose.prod.yml` overlays an **nginx** reverse proxy that terminates TLS and a
**certbot** sidecar that issues/renews **Let's Encrypt** certificates. GitHub Actions
runs tests + image builds (CI) and deploys to this box (CD).

```
Internet ──443/80──► nginx (TLS) ──┬─► backend   :8000   (api.DOMAIN)
                                   └─► dashboard :3000   (dash.DOMAIN)
                        certbot ── renews certs into a shared volume, nginx reloads every 6h
```

## One-time server setup

1. **Launch EC2** — Ubuntu 22.04, `t3.small`+ (Mumbai/Singapore). Security group inbound:
   `22` (your IP only), `80`, `443`. **Do not** open `8000`/`3000` — nginx reaches them
   over the internal docker network.

2. **DNS** — point two A-records at the instance's public IP:
   `api.yourorg.com.np` and `dash.yourorg.com.np`.

3. **Install Docker + clone**
   ```bash
   sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
   sudo usermod -aG docker $USER && newgrp docker
   git clone <your-repo-url> ~/fieldos && cd ~/fieldos
   ```

4. **Configure `.env`** (never committed)
   ```bash
   cp .env.example .env
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # -> JWT_SECRET_KEY
   nano .env
   ```
   Set at minimum: `POSTGRES_PASSWORD`, `JWT_SECRET_KEY`, `API_DOMAIN`, `DASH_DOMAIN`,
   `LETSENCRYPT_EMAIL`, `ORG_NAME`/`ORG_TAGLINE`, and `CORS_ORIGINS=https://dash.yourorg.com.np`.

5. **Issue TLS certs** (starts nginx, obtains real certs, reloads)
   ```bash
   ./deploy/init-letsencrypt.sh          # add STAGING=1 first to dry-run against LE staging
   ```

6. **Bring the full stack up + seed once**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm backend python seed_demo.py
   ```
   Verify: `https://api.yourorg.com.np/health` and `https://dash.yourorg.com.np`.

7. **Point the mobile app** at the API — in `fieldos-app/eas.json`:
   ```
   EXPO_PUBLIC_API_URL=https://api.yourorg.com.np/api/v1
   EXPO_PUBLIC_ENABLE_MOCK_SYNC=false
   ```
   then `cd fieldos-app && eas build --profile preview --platform android`.

## CI/CD (GitHub Actions)

- **`.github/workflows/ci.yml`** — on every PR and push to `main`: backend `pytest`,
  dashboard `npm run build`, and both Docker images build.
- **`.github/workflows/deploy.yml`** — after CI succeeds on `main` (or manual dispatch):
  SSHes into the box, `git reset --hard origin/main`, rebuilds the stack.

Add these **repo secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `EC2_HOST` | instance public IP / hostname |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | full contents of the `.pem` private key |
| `DEPLOY_PATH` | repo path on the server, e.g. `/home/ubuntu/fieldos` |

> The deploy job never touches `.env` — secrets live only on the server. Schema changes
> apply on boot via `Base.metadata.create_all`; for evolving schemas run
> `alembic upgrade head` inside the backend container after deploy.

## Cert renewal

`certbot` auto-renews (checks twice daily, renews within 30 days of expiry) and nginx
reloads every 6h to pick up new certs — no cron needed. Force a manual renewal:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm certbot renew --force-renewal
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx nginx -s reload
```
