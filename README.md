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

## Conventions

- British English in UI copy; Conventional Commits; one commit per feature.
- Every table carries `account_id`; every query is scoped by the request context (`src/shared/context.ts`).
- Couriers are declarative profiles executed by one connector engine (`apps/api/src/couriers/`), never per-courier code.
- Cost bands are append-only; a price change is a new row with a later `effective_from`.
- The audit log is append-only and holds actions, manual notes and record views.
