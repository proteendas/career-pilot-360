# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security vulnerability.

Instead, email **prot.das15@gmail.com** with enough detail to reproduce the issue. Please do not test against other people's accounts or data while investigating — use your own account or a local instance.

If you're running your own deployment of this project, replace the address above with your own contact address wherever it appears (see `src/app/(marketing)/security/page.tsx`, `terms/page.tsx`, `privacy/page.tsx`, and `src/components/marketing/site-footer.tsx`).

## What's in scope

- Authentication/session handling (`src/lib/auth/`)
- Tenant isolation — any path that could read or write another user's data
- The upload validation and SSRF-safe fetching in `src/lib/security.ts`
- Encryption of stored AI provider keys (`src/lib/crypto.ts`)
- Prompt-injection paths that escalate beyond "a bad draft the user reviews" (e.g. a tool call executing without the confirmation gate it's supposed to have)
- The outreach send pipeline's safety checks (suppression list, rate limit, duplicate-recipient cooldown) being bypassable

## What's likely not a new report

- The ATS score not matching a real employer's ATS — it's explicitly a heuristic, not a security issue.
- A job source returning stale or incomplete data — the app is transparent about what it did and didn't search (see the coverage note returned by every search).
- Rate limits or the daily outreach cap being reachable by design — report if they can be *bypassed*, not that they exist.

## Supported versions

This project does not yet have a formal release/version support policy — it's a single, continuously-deployed `main` branch. Report against the latest commit on `main`.
