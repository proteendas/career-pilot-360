# Contributing to CareerPilot360

Thanks for considering a contribution. Before writing code, please read [ARCHITECTURE.md](ARCHITECTURE.md), especially [Non-negotiable design rules](ARCHITECTURE.md#non-negotiable-design-rules) — a technically-good PR that crosses one of those (scraping a job portal, auto-submitting an application, fabricating a resume claim) will be closed regardless of code quality.

## Local setup

```bash
git clone <your-fork-url>
cd ai-job-tool
npm install
cp .env.example .env.local     # fill in DATABASE_URL and AUTH_SECRET at minimum
npm run db:migrate             # or set DATABASE_URL="pglite://.pglite" for a zero-install local Postgres
npm run db:seed
npm run dev
```

`.env.example` documents every variable, what it unlocks, and how to generate each secret.

## Before opening a PR

```bash
npm run verify     # typecheck + unit/integration tests — must pass
npm run lint       # must report 0 errors (warnings are fine to leave for pre-existing ones)
```

If your change touches a page or component, actually load it in a browser (`npm run dev`) — type-checking and unit tests verify code correctness, not that the feature works. For anything touching layout, check a mobile viewport width (320–375px) too; several real overflow bugs in this codebase were only caught that way.

If you have [Playwright](https://playwright.dev) browsers installed, `npm run test:e2e` runs the e2e suite (auth, navigation, accessibility, feature flows) against a real dev server.

## Coding conventions

- **TypeScript strict mode.** No `any` without a good reason and a comment explaining it.
- **Zod at every boundary.** Every server action input and every AI structured-output schema is validated with Zod — never trust a client-supplied value or a raw model response.
- **Deterministic first.** If you're adding an AI-assisted feature, it needs a working non-AI fallback before the AI path is acceptable to merge. See `generateObjectOrFallback` in `src/lib/ai/client.ts` for the pattern.
- **Every outward-facing side effect needs an explicit confirmation step.** Sending an email, marking something submitted, opening a third-party URL — the user must see the exact content and click a real confirm button. See `src/lib/outreach/send.ts` for the reference implementation (idempotency key, suppression check, rate limit, duplicate-recipient cooldown, audit record).
- **Tenant isolation.** Every query that touches user-owned data needs a `user_id` predicate. There is no exception.
- **Comments explain *why*, not *what*.** If a comment just restates the code, delete it. Write one only for a non-obvious constraint, a workaround, or something that would surprise a future reader.
- **No new abstractions for a single call site.** Three similar lines beat a premature helper.

## Adding a new AI provider

Providers live in `src/lib/ai/registry.ts` as data (id, wire-protocol kind, models, pricing notes). If the provider speaks one of the three existing wire protocols (OpenAI-compatible, Anthropic, Google), you likely only need a registry entry — the adapters in `src/lib/ai/providers/` are shared. **Verify the model IDs you add are actually live** — providers retire models on their own schedule (this bit us once already; see the comment above the Groq entry in `registry.ts`).

## Adding a new job source

Read `src/lib/jobs/registry.ts` first — it's the authoritative, permitted-sources list. A new source needs:
1. A registry entry describing its `sourceType` (`public_board`, `authorized_api`, `user_provided`, `manual`) and what it's allowed to do.
2. An adapter implementing `JobSourceAdapter` in `src/lib/jobs/adapters/`.
3. If it can search by keyword rather than by company, it needs credentials and a `SourceAvailability` check — see `AdzunaAdapter.isConfigured()` for the pattern.

A PR adding a scraper for a portal that doesn't offer a public API or board feed will not be merged.

## Database changes

```bash
# edit src/lib/db/schema.ts, then:
npm run db:generate    # writes a new migration into src/lib/db/migrations/
npm run db:migrate      # applies it locally
```

Commit the generated migration file — it's part of the schema history, not a build artifact.

## Filing issues

- **Bug reports**: use the bug report template; include the exact page/URL, what you expected, and what happened. A screenshot at a real viewport width is more useful than a description for layout bugs.
- **Security issues**: do **not** open a public issue — see [SECURITY.md](SECURITY.md).
- **Feature requests**: check [Non-negotiable design rules](ARCHITECTURE.md#non-negotiable-design-rules) first; a request that requires scraping or auto-submission will be declined regardless of demand.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind; assume good faith.
