# Deploying Smooth Parcel V4 on Coolify

One Coolify "Docker Compose" resource runs four services from `infra/coolify/docker-compose.yml`:
Postgres, the API (which also serves the MCP server and the public tracking page), the worker,
and the web app. Everything is built from this repository; nothing is pulled from a registry.

## 1. Prepare the VPS

- Ubuntu 22.04 or 24.04 with Coolify v4 installed and reachable.
- Two DNS records pointing at the VPS: `api.<your-domain>` and `app.<your-domain>`
  (for Smooth Parcel itself: `api.smoothparcel.com` and `app.smoothparcel.com`).
  Coolify issues Let's Encrypt certificates for both.

## 2. Create the resource

1. Coolify → Projects → your project → **New resource → Docker Compose** (GitHub source).
2. Repository `roger296/spv4`, branch `main`, compose file `infra/coolify/docker-compose.yml`.
3. In the resource's **Domains**, set the `api` service to `https://api.<your-domain>` (port 3100)
   and the `web` service to `https://app.<your-domain>` (port 80). Leave `postgres` and `worker` without domains.
4. In **Environment variables**, set (generate secrets with `openssl rand -hex 32`):

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | a long random string |
| `JWT_SECRET` | a long random string |
| `ENCRYPTION_KEY` | a long random string. **Back this up**: courier credentials cannot be recovered without it |
| `API_DOMAIN` | `api.<your-domain>` (no scheme) |
| `WEB_DOMAIN` | `app.<your-domain>` |
| `MOLLIE_API_KEY` | `test_…` or `live_…` from the Mollie dashboard |
| `ANTHROPIC_API_KEY` | for the AI features; leave empty to run without them |
| `SMTP_URL` | e.g. `smtps://user:pass@smtp.example.com:465`; empty logs mail instead |
| `MAIL_FROM` | `Smooth Parcel <no-reply@<your-domain>>` |

Optional: `SUBSCRIPTION_WEEKLY_AMOUNT_GBP` (default 15.00), `TRIAL_DAYS` (14), `AI_DAILY_BUDGET_GBP` (5),
`TRACKING_POLL_CRON` (`15 */4 * * *`), `DOCUMENT_RETENTION_DAYS` (548), `LOG_LEVEL` (info).

Coolify keeps the first-deployed value of any `${VAR:-default}`; change values in Coolify, not in the compose file.

5. **Deploy.** The API container runs the migrations on every start, so the schema is created on first boot.

## 3. First run

From the API container's terminal in Coolify (or `docker exec -it <api-container> sh`):

```bash
npx tsx scripts/create-admin.ts --email you@example.com --name "Your Name" --password '<a strong password>'
```

Then:

- Open `https://app.<your-domain>/sign-up` and create the first business account (14-day trial).
- Settings → Warehouses: complete the dispatch address, phone and EORI.
- Couriers → Add: pick Royal Mail (Click & Drop) or DPD UK, enter the credentials, press **Test**.
- Shipping methods → Add from services, then set cost bands (or import the CSV).
- Integrations → API keys: create a key with `orders:write orders:read labels:read` for smmta-next.

## 4. Connecting Claude Cowork (MCP)

Add a custom connector with the URL `https://api.<your-domain>/mcp`. Cowork discovers the OAuth
endpoints, opens the Smooth Parcel sign-in page, and receives a token scoped to that account. The
connection appears under Integrations → MCP connections and can be revoked there.

## 5. Mollie

In the Mollie dashboard, no webhook needs configuring by hand: every payment and subscription is
created with `webhookUrl = https://api.<your-domain>/v4/billing/webhook`. Use a test key first;
the checkout flow works end to end in test mode.

## 6. Backups

- Postgres: Coolify's scheduled database backups on the `postgres` service (daily, kept 14 days is sensible).
- Documents: the `spv4_documents` volume holds label PDFs for 18 months; include it in the VPS snapshot.
- Secrets: store `ENCRYPTION_KEY`, `JWT_SECRET` and `POSTGRES_PASSWORD` in a password manager.

## 7. Health

- `https://api.<your-domain>/health` → `{ "status": "ok" }`.
- `https://api.<your-domain>/docs` → OpenAPI UI.
- Admin portal API: `https://api.<your-domain>/v4/admin/health` with an admin token shows courier error rates, tracking backlog and webhook backlog.

## Local equivalent

`docker compose up -d` (Postgres on 5433), `npm run dev -w @spv4/api`, `npm run dev -w @spv4/web`, `npm run worker -w @spv4/api`.
