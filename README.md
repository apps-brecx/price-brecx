# Priceobo

Multi-channel pricing automation — Amazon, Walmart, Shopify, TikTok, eBay, Etsy, Faire.

A TypeScript monorepo (pnpm workspaces + Turborepo):

- **`apps/api`** — Node 20 + Fastify 4, PostgreSQL via `postgres.js`, `node-pg-migrate`
  migrations, `pg-boss` job queue, cookie-based sessions (bcryptjs), WebSockets,
  Cloudflare R2 (AWS S3 SDK v3), Nodemailer SMTP, pino logging, Sentry.
- **`apps/web`** — React 18 SPA, Vite 5, react-router-dom 6, TanStack Query 5,
  Zod, PWA (`vite-plugin-pwa`), `@zxing` barcode scanning, Sentry. Plain CSS:
  shared tokens in `src/styles/`, a sibling `Name.css` next to each route/component.
- **`packages/shared`** — `@fbm/shared`: Zod schemas, types and constants used by
  both apps.
- **`render.yaml`** — Render Blueprint (API web service + static web site).
- **Database** — PostgreSQL ([Neon](https://neon.tech) in production).

## Local development

```bash
# 1. Install (pnpm)
corepack enable
pnpm install

# 2. API env
cp apps/api/.env.example apps/api/.env
# Fill DATABASE_URL (Neon or local Postgres) and SESSION_SECRET

# 3. Migrate
pnpm db:migrate

# 4. (Optional) bootstrap an owner — seeds NO product data
SEED_EMAIL=you@example.com SEED_PASSWORD=changeme123 pnpm db:seed

# 5. Run both dev servers
pnpm dev
#  → API  http://localhost:4000
#  → Web  http://localhost:5173  (Vite proxies /api and /ws to the API)
```

If you didn't seed, open `http://localhost:5173/sign-up` to create the first
workspace.

## Production deploy (Render + Neon)

1. Create a **Neon** project; copy the **pooled** connection string.
2. Connect this repo to **Render** — it detects `render.yaml`.
3. In the Render dashboard set:
   - `priceobo-api` → `DATABASE_URL` = Neon URL (append `?sslmode=require`)
   - `priceobo-api` → `CORS_ORIGIN` = the static site URL
   - `priceobo-web` → `VITE_API_URL` = the API URL
4. Deploy. Migrations run automatically in the API `preDeployCommand`
   (`node-pg-migrate up`).
5. Sign up at the web URL to create the first workspace.

## Amazon SP-API

The integration is ported from the previous production server and lives behind
an interface in `apps/api/src/amazon/`:

- `spapi.ts` — live provider: LWA refresh-token grant, Listings price `PATCH`,
  Catalog/offer reads.
- `stub.ts` — used automatically when SP-API credentials are absent, so
  schedules, jobs and the activity log still work end-to-end.

Set `SPAPI_REFRESH_TOKEN`, `SPAPI_LWA_APP_ID`, `SPAPI_LWA_CLIENT_SECRET`,
`SPAPI_SELLER_ID`, `SPAPI_MARKETPLACE_ID` to activate the live provider. Scheduled
price changes are queued with `pg-boss`; when a job runs it pushes the price via
the provider, updates the DB, logs activity, and broadcasts over the WebSocket so
open clients refresh.

## Pages

All 16 pages from the redesign are implemented as real React routes wired to the
API — **no prototype mock data**. Lists show empty states until real data
exists.

Dashboard · Calendar · Products · SKUs · Inventory · Price Alert · Pricing v2 ·
Automation · Buy Box · Price Alert v2 · Sales Alert · Report · Activity Log ·
Status · History · Settings (general / team / marketplaces).

## Auth & multi-tenancy

- Cookie-based sessions (`fbm_session`, httpOnly), passwords bcrypt-hashed.
- Every authenticated request is scoped to the user's workspace.
- Sign-up creates a workspace + owner user.

## Project layout

```
price-brecx/
├── apps/
│   ├── api/
│   │   ├── migrations/         # node-pg-migrate (.cjs)
│   │   └── src/
│   │       ├── amazon/         # SP-API provider (live + stub)
│   │       ├── auth/           # sessions + fastify plugin
│   │       ├── routes/         # one file per resource
│   │       ├── db.ts jobs.ts ws.ts mailer.ts storage.ts
│   │       └── index.ts        # Fastify entrypoint
│   └── web/
│       └── src/
│           ├── components/     # AppLayout, Modal, Badges, BarcodeScanner…
│           ├── lib/            # api client, auth, realtime, format
│           ├── pages/          # one .tsx + .css per route
│           └── styles/         # tokens.css, reset.css, app.css
├── packages/shared/            # @fbm/shared (Zod schemas/types/constants)
├── render.yaml
├── turbo.json
└── pnpm-workspace.yaml
```
