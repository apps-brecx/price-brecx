# Priceobo

Multi-channel pricing automation app — Amazon, Walmart, Shopify, TikTok, eBay, Etsy, Faire.

This repo contains:

- **`apps/api`** — Fastify + Prisma backend, JWT auth (email + password)
- **`apps/web`** — React + Vite + Tailwind frontend
- **`render.yaml`** — Render Blueprint (deploys both services)
- **Database** — PostgreSQL (use [Neon](https://neon.tech) in production)

## Local development

```bash
# 1. Install
npm install

# 2. Set up the API env
cp apps/api/.env.example apps/api/.env
# Fill in DATABASE_URL (Neon or local Postgres) and JWT_SECRET

# 3. Migrate the database
npm run db:migrate -- --name init

# 4. (Optional) Seed an initial owner user + workspace
SEED_EMAIL=you@example.com SEED_PASSWORD=changeme npm run db:seed

# 5. Run both dev servers
npm run dev
# → API on http://localhost:4000
# → Web on http://localhost:5173 (Vite proxies /api to the API)
```

Visit `http://localhost:5173/sign-up` if you didn't seed a user.

## Production deploy (Render + Neon)

1. **Create a Neon project** and grab the pooled connection string.
2. **Connect this repo to Render** and let it detect `render.yaml`.
3. Set the following in the Render dashboard once both services exist:
   - `priceobo-api` → `DATABASE_URL` = your Neon URL (`?sslmode=require`)
   - `priceobo-api` → `CORS_ORIGIN` = the static site URL (e.g. `https://priceobo-web.onrender.com`)
   - `priceobo-web` → `VITE_API_URL` = the API URL (e.g. `https://priceobo-api.onrender.com`)
4. Trigger a deploy. The API build runs `prisma migrate deploy` automatically.
5. Sign up at the web URL to create the first workspace.

## What's in here

### Pages
- **Dashboard** — KPI cards, connected marketplaces, upcoming schedules, recent alerts, recent activity (all live from API)
- **Calendar** — Month grid with scheduled price changes; cancel / execute now
- **Products** — CRUD with channels overview
- **SKUs** — Filters (status / favorites), bulk actions, schedule-price drawer
- **Inventory** — Per-product warehouses with shipments
- **Pricing** — Multi-marketplace listings with channel filters, inline price edit
- **Pricing v2** — Grid-style cards with `+more` expand drawer
- **Automation** — Rules with conditions / adjustments and SKU picker
- **Buy Box** — Stats, listings, auto-reprice toggle, manual reprice
- **Price Alert / Sales Alert** — Severity dots, snooze/resolve/dismiss
- **Reports** — Time-series line chart, monthly bars, marketplace pie (Recharts)
- **Activity Log** — Paginated, filterable, CSV export
- **Settings**
  - General — workspace name/plan
  - Team — invite, role change, remove
  - Marketplaces — connect / disconnect / sync
  - Tags — CRUD with colors
  - Notifications — multi-category rules with channels (email/slack/sms/webhook)
  - API Keys — generate / revoke (one-time reveal)
  - Webhooks — URL + events

### Data
The app starts **empty**. Every list page shows an empty state and prompts you to add the first item. Nothing is hard-coded from the prototype.

### Auth & multi-tenancy
- JWT-based auth (email + password, bcrypt-hashed)
- Every authenticated request scopes to the active workspace via `x-workspace-id` header
- Users can belong to multiple workspaces; sign-up creates one automatically
- Roles: `OWNER`, `ADMIN`, `USER`, `VIEWER`

## What's NOT built (yet)

The plan (`PRICEOBO_APP_PLAN.md`) describes additional production work that this foundation is ready for but doesn't include:

- **Real marketplace OAuth + adapters** — connection records are stored, but no actual Amazon SP-API / Walmart / etc. calls. Add adapters in `apps/api/src/marketplaces/`.
- **Background jobs** — `apps/api` runs schedules synchronously when you POST `/api/schedules/:id/execute`. Wire BullMQ / Inngest for production cron.
- **Email / Slack / SMS delivery** — `POST /notification-rules/:id/test` only marks `lastSentAt`. Add Resend / Slack webhook integration.
- **Token encryption at rest** — `MarketplaceConnection.accessToken` is stored as plain text. Add AES-256 with KMS before going live.
- **Real-time updates** — UI polls via React Query. Add SSE / WebSocket / Supabase Realtime for live activity.

## Project layout

```
priceobo/
├── apps/
│   ├── api/
│   │   ├── prisma/        # schema.prisma + seed.ts
│   │   └── src/
│   │       ├── lib/       # prisma client, auth middleware, env
│   │       ├── routes/    # one file per resource
│   │       └── index.ts   # Fastify entrypoint
│   └── web/
│       └── src/
│           ├── components/    # layout + ui primitives
│           ├── lib/           # api client, auth context, utils
│           ├── pages/         # one file per route
│           └── styles/        # design tokens
├── render.yaml
└── package.json           # npm workspaces
```
