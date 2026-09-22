# Smooth Parcel V4

Bring-your-own-courier shipping labels and tracking for small online retailers. Connect your own
Royal Mail and DPD accounts (or describe any other courier's API without writing code), and
Smooth Parcel picks the cheapest suitable service, buys the label, prints it on your stationery,
tracks the parcel and flags problems early. Companion app to [smmta-next](https://github.com/roger296/smmta-next).

The specification lives in the project's Claude Doc; this README covers running the code.

## Layout

```
apps/api        Fastify + Drizzle + Postgres API, worker and MCP server   (port 3100)
apps/web        Vite + React admin app                                    (port 5174)
packages/shared-types  Wire types shared by api, web and MCP
infra/          Coolify / docker-compose deployment
```

## Local development

```bash
docker compose up -d                      # Postgres 16 on 127.0.0.1:5433 (dev + test databases)
npm install
npm run build -w @spv4/shared-types
cp apps/api/.env.example apps/api/.env    # then set JWT_SECRET and ENCRYPTION_KEY
npm run db:migrate -w @spv4/api           # dev database
npm run db:migrate:test -w @spv4/api      # test database
npm run dev -w @spv4/api                  # API at http://127.0.0.1:3100, docs at /docs
npm run dev -w @spv4/web                  # web app at http://localhost:5174
```

## Tests

```bash
npm test -w @spv4/api    # unit + integration against the spv4_test database
```

Tests never touch the dev database: `apps/api/test/setup.ts` points `DATABASE_URL` at
`TEST_DATABASE_URL` (default `spv4_test`).

## What is where

| Area | Path |
| --- | --- |
| Order intake, pre-flight check, orders API | `apps/api/src/modules/orders/` |
| Connector engine, templates, profile schema | `apps/api/src/couriers/` (built-in Royal Mail and DPD in `builtin/`) |
| Courier profiles and accounts API | `apps/api/src/modules/couriers/` |
| Shipping methods and cost bands | `apps/api/src/modules/methods/` |
| Method selection, label purchase, PDFs | `apps/api/src/modules/labels/` |
| Tracking poll, exception rules, problems, public tracking page | `apps/api/src/modules/tracking/` |
| MCP server and OAuth for Claude Cowork | `apps/api/src/mcp/` (served at `/mcp`) |
| AI jobs: profile drafting, problem triage, product data, invoice reconciliation | `apps/api/src/modules/ai/` |
| Mollie subscriptions | `apps/api/src/modules/billing/` |
| Platform admin API | `apps/api/src/modules/admin/` |
| Worker jobs (pg-boss) | `apps/api/src/worker/` |
| Deployment (Coolify) | `infra/coolify/docker-compose.yml`, `docs/DEPLOY.md` |

Dev seed: `npm run seed:dev -w @spv4/api` creates `dev@example.test` / `dev-password-1` with a warehouse,
products and a Royal Mail courier account with placeholder credentials. Platform admin:
`npx tsx apps/api/scripts/create-admin.ts --email … --name … --password …`.

## Conventions

- British English in UI copy; Conventional Commits; one commit per feature.
- Every table carries `account_id`; every query is scoped by the request context (`src/shared/context.ts`).
- Couriers are declarative profiles executed by one connector engine (`apps/api/src/couriers/`), never per-courier code.
- Cost bands are append-only; a price change is a new row with a later `effective_from`.
- The audit log is append-only and holds actions, manual notes and record views.
