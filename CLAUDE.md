<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## CareerPilot360 — navigation and conventions

### Navigate via the graph, not by grepping
This project has a graphify knowledge graph at `graphify-out/` (code-only, local
tree-sitter AST — no LLM, nothing leaves the machine).

- Before answering an architecture or "where does X live" question, read
  `graphify-out/GRAPH_REPORT.md` for the community hubs.
- Query `graphify-out/graph.json` instead of reading files speculatively:
  - `graphify explain "<symbol>"` — what a thing connects to
  - `graphify path "<a>" "<b>"` — how two things relate
  - `graphify query "<question>"` — a scoped subgraph
- Regenerate after changing code: `graphify . --code-only && graphify cluster-only .`
  (`--code-only` avoids needing an LLM key.)
- Every edge is tagged `EXTRACTED` (explicit in the source) or `INFERRED`
  (resolved by graphify). Trust EXTRACTED; verify INFERRED before relying on it.

### Where things live
| Concern | Module | Rule |
|---|---|---|
| Untrusted input | `src/lib/security.ts` | ALL external data passes through here first. Calling `fetch()` on a user URL anywhere else is a bug. |
| Tenant isolation | `src/lib/db/tenant.ts` | Every user-owned read/write forces a `user_id` predicate. |
| Secrets | `src/lib/crypto.ts` | AES-256-GCM, key-ring rotation. Decrypt only server-side. |
| Audit | `src/lib/audit.ts` | The only writer to `audit_events`. Append-only, redacted. |
| AI | `src/lib/ai/` | Provider-neutral. `prompts.ts` fences untrusted content. |
| Resume pipeline | `src/lib/resume/` | `parse` → `normalize` → `ats` → `suggestions` → `pdf`, joined by `service.ts`. |
| Job sources | `src/lib/jobs/registry.ts` | The authoritative list of permitted sources. No crawler exists. |
| App state | `src/lib/applications/state.ts` | Submission statuses are actor-gated. |

### Non-negotiable product rules
- Never scrape or automate LinkedIn, Naukri, Indeed or Glassdoor.
- Never introduce a number into resume content that is not already in the
  user's own material (`findFabricatedMetrics` enforces this).
- Never mark an application submitted without a direct user action
  (`assertTransition` enforces this).
- Every outward-facing side effect needs an explicit confirmation first.
- The ATS score is a heuristic and must always be described as one.

### Verify before claiming done
`npm run typecheck && npm run lint && npm test`
