# CareerPilot360

A multi-tenant AI job-application assistant. Every AI output is reviewed by a
human before use; nothing is auto-submitted to a job board, no LinkedIn
account is ever automated, and no resume fact is ever fabricated. See
`CLAUDE.md` for the full set of product and compliance rules this codebase
enforces.

Deployment target: **Vercel only** (Vercel Postgres/Marketplace Postgres +
Vercel Blob + Vercel Cron). There is no Docker image and no other supported
host.

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript strict
- Drizzle ORM — `postgres.js` in production, PGlite (WASM Postgres) for local
  dev and tests, behind one shared `Database` type
- Auth.js v5 (JWT sessions) — email/password + LinkedIn OIDC sign-in
- Vercel Blob for resume storage, Vercel Cron for scheduled tasks
- Provider-neutral AI abstraction (users bring their own key; an optional
  app-level fallback key can be configured)

## Local development

```bash
cp .env.example .env.local        # fill in DATABASE_URL and AUTH_SECRET at minimum
npm install
npm run db:migrate                # or: DATABASE_URL="pglite://.pglite" npm run db:migrate
npm run db:seed                   # job-source registry (safe to re-run); add --demo for a sample account
npm run dev
```

For a zero-install local database, set `DATABASE_URL="pglite://.pglite"` in
`.env.local` — this runs real Postgres compiled to WASM, in-process. Swap in a
real `postgresql://` URL at any time without touching the schema.

Before committing, run:

```bash
npm run verify   # typecheck + test
npm run lint
```

## Deploying to Vercel

### 1. Provision the database

Vercel dashboard → your project → **Storage** → **Create Database** → pick a
Postgres provider from the Marketplace (Neon, Supabase, and Prisma Postgres
have all been tested). Vercel injects `DATABASE_URL` into the project
automatically — you don't set it by hand.

### 2. Provision Blob storage

**Storage** → **Create Database** → **Blob**. Connect it to the project;
Vercel injects `BLOB_READ_WRITE_TOKEN` automatically. Resumes are written with
`access: 'private'` and served only through authenticated routes.

### 3. Set the remaining environment variables

In **Settings → Environment Variables**, set at minimum:

| Variable | Required | Notes |
|---|---|---|
| `AUTH_SECRET` | Yes | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | Yes | Your production URL, e.g. `https://careerpilot360.vercel.app` |
| `ENCRYPTION_KEY` | Recommended | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — required before any user can save an AI provider key |
| `CRON_SECRET` | Recommended | `openssl rand -hex 32` — Vercel sends this automatically as a bearer token to the cron routes once set |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | Optional | Only if you want "Sign in with LinkedIn" (OIDC sign-in only — no portal automation, no stored access token) |
| `EMAIL_PROVIDER` / `RESEND_API_KEY` / `EMAIL_FROM` | Optional | Defaults to `console` (logs instead of sending); set `EMAIL_PROVIDER=resend` for real outreach delivery |
| `SEARCH_PROVIDER` / `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Optional | Adds the Adzuna aggregator on top of the always-on Greenhouse/Lever/Ashby sources |
| `APP_AI_PROVIDER` / `APP_AI_API_KEY` / `APP_AI_MODEL` | Optional | A shared fallback AI key so the app is usable before a user adds their own in Settings |

`.env.example` at the repo root documents every variable, what it unlocks,
and exactly how to generate each secret — copy from there rather than from
this table for the full context.

Do **not** set `DATABASE_URL` or `BLOB_READ_WRITE_TOKEN` yourself if you
provisioned them through the Vercel Marketplace/Storage tabs — Vercel manages
those.

If you're setting a LinkedIn OIDC redirect URL, it's:
`https://<your-domain>/api/auth/callback/linkedin`.

### 4. Deploy

```bash
vercel link      # first time only
vercel deploy --prod
```

Or connect the GitHub repo in the Vercel dashboard for deploys on push. The
build runs `next build`; no extra build command is needed.

### 5. Run migrations against the production database

Migrations are **not** run automatically on deploy — run them explicitly,
once, per schema change:

```bash
vercel env pull .env.production.local --environment=production
DATABASE_URL="$(grep ^DATABASE_URL .env.production.local | cut -d= -f2-)" npm run db:migrate
```

Then seed the job-source registry (idempotent, safe to re-run, do **not**
pass `--demo` in production):

```bash
DATABASE_URL="..." npm run db:seed
```

### 6. Verify

- Visit the deployed URL, sign up, complete onboarding.
- Settings → AI providers: confirm the "not configured" state renders
  honestly if you haven't set `APP_AI_API_KEY` (it should never fake data).
- Upload a resume and confirm it round-trips through Blob.
- Check `vercel.json` — it declares two cron routes, `/api/cron/enqueue-schedules`
  (06:00 UTC) and `/api/cron/process-tasks` (06:15 UTC). **These routes are not
  implemented yet** in this codebase (Phase 6 scheduling work is still
  pending) — Vercel will register the schedule but calls will 404 until those
  routes are added.
  - Both are currently once-daily because **Vercel's Hobby plan caps every
    cron job at one run per day** — a `*/5 * * * *` or hourly schedule will
    be rejected at deploy time on Hobby. On Pro (or higher), you can tighten
    `process-tasks` back down to every 5–15 minutes for near-real-time
    background task processing; once-daily is a real functional downgrade
    for anything time-sensitive (e.g. same-day scheduled reminders), not
    just a cosmetic limit.

## Notes for anyone maintaining this deployment

- `vercel.json` sets `maxDuration: 60` on all API routes and declares the
  cron schedule — check it if you add new long-running routes.
- `next.config.ts` sets a strict CSP (self + Google Fonts only) and standard
  security headers; if you add a new external asset host you must widen the
  CSP there.
- `ENCRYPTION_KEY` supports comma-separated rotation
  (`"newKey,oldKey"`) — see the comment in `.env.example` before rotating.
- There is no scraping, browser automation, or third-party auto-submit
  anywhere in this codebase by design — see `CLAUDE.md` for the compliance
  rules this repo is not allowed to violate, even under a feature request.
