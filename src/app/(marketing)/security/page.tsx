import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/marketing/legal-page';

export const metadata: Metadata = {
  title: 'Security',
  description: 'The concrete controls behind CareerPilot360: encryption, tenant isolation, SSRF protection and audit.',
};

export default function SecurityPage() {
  return (
    <LegalPage
      title="Security"
      updated="1 August 2026"
      intro={
        <p>
          This page describes mechanisms, not intentions. Each control below corresponds to code you can point at, and
          most are covered by tests.
        </p>
      }
      sections={[
        {
          id: 'threat-model',
          heading: 'What we are defending against',
          body: (
            <>
              <p>Four things drive most of the design:</p>
              <ul>
                <li>
                  <strong>Cross-tenant leakage.</strong> This is a multi-user product holding resumes, salary
                  expectations and application history. One user reading another’s data is the worst outcome available.
                </li>
                <li>
                  <strong>Untrusted document content.</strong> Resumes and job descriptions arrive from outside. They may
                  contain text engineered to steer an AI model, or markup engineered to execute in a browser.
                </li>
                <li>
                  <strong>Server-side request forgery.</strong> The product fetches URLs that users paste. Without
                  controls, that is a request generator pointed at our own network.
                </li>
                <li>
                  <strong>Secret exposure.</strong> Users hand us AI provider keys. Those must never appear in a
                  response body, a log line, an audit record or an export.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'tenant-isolation',
          heading: 'Tenant isolation',
          body: (
            <ul>
              <li>
                Every user-owned table carries <code className="font-mono text-sm">user_id NOT NULL</code> with{' '}
                <code className="font-mono text-sm">ON DELETE CASCADE</code>, and an index leading with that column.
              </li>
              <li>
                Reads and writes go through helpers that force a <code className="font-mono text-sm">user_id</code>{' '}
                predicate into the query. There is no code path that fetches a resume by id alone.
              </li>
              <li>
                A request for a record that exists but belongs to someone else returns the same “not found” as a record
                that does not exist, so identifiers cannot be probed.
              </li>
              <li>Loaded rows are re-checked against the session before use — defence in depth, not just at the query.</li>
              <li>Assistant tool calls are scoped to the authenticated user; a tool cannot widen its own scope.</li>
            </ul>
          ),
        },
        {
          id: 'secrets',
          heading: 'Secrets and provider keys',
          body: (
            <ul>
              <li>
                Provider keys are sealed with <strong>AES-256-GCM</strong> — authenticated encryption, so tampering is
                detected rather than silently decrypted.
              </li>
              <li>
                The encryption key lives only in an environment variable. It supports rotation: several keys may be
                configured, the first encrypts, all are tried on decrypt, so you can re-encrypt in the background and
                then retire the old key.
              </li>
              <li>After you save a key, the plaintext is never returned to the browser. The UI shows the last four characters.</li>
              <li>Keys are decrypted only inside server-side execution, immediately before a provider call.</li>
              <li>
                Audit metadata passes through a redactor that replaces anything key-shaped and strips bulk document
                text, recording lengths instead.
              </li>
              <li>Passwords are hashed with bcrypt at cost 12. A sign-in attempt for an unknown account still performs comparable work, so timing does not reveal whether the account exists.</li>
            </ul>
          ),
        },
        {
          id: 'untrusted-content',
          heading: 'Untrusted content and prompt injection',
          body: (
            <>
              <p>
                Resume text and job descriptions are treated as data, never as instructions. Concretely:
              </p>
              <ul>
                <li>
                  System instructions are assembled separately from imported content, and imported content is delimited
                  and labelled as untrusted in the prompt.
                </li>
                <li>A job description cannot alter system instructions, and imported content cannot invoke a tool.</li>
                <li>
                  Every tool argument is validated against a schema before execution, and every tool that changes data
                  requires your confirmation first.
                </li>
                <li>
                  Control characters, zero-width characters and bidirectional overrides are stripped on import — these
                  are how instructions get hidden from a human reviewer.
                </li>
                <li>
                  Job and resume text is rendered as plain text, never as HTML. Fetched markup is reduced to text before
                  it is stored.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'ssrf',
          heading: 'Fetching URLs you paste',
          body: (
            <>
              <p>
                All outbound fetching of user-supplied URLs goes through a single function. It enforces:
              </p>
              <ul>
                <li>http and https only — no file, gopher, or data schemes.</li>
                <li>No credentials embedded in the URL.</li>
                <li>
                  Refusal of loopback, link-local, private, CGNAT and multicast addresses, and of cloud metadata
                  hostnames. IPv6 forms, including IPv4-mapped addresses, are checked too.
                </li>
                <li>Redirects followed manually, with every hop re-validated — a public URL cannot redirect inward.</li>
                <li>A hard byte cap and a request timeout, so a hostile endpoint cannot exhaust memory or hold a function open.</li>
                <li>No cookies sent, and per-adapter host allowlists where the source is a known job board.</li>
              </ul>
              <p>
                Platforms that do not permit programmatic access — LinkedIn, Naukri, Indeed, Glassdoor among them — are
                on a no-fetch list. Pasting one of their URLs stores a link and the details you supply; nothing is
                requested from them.
              </p>
            </>
          ),
        },
        {
          id: 'uploads',
          heading: 'File uploads',
          body: (
            <ul>
              <li>PDF and DOCX only, 1 MB maximum.</li>
              <li>
                Validated by extension <em>and</em> magic bytes, so a renamed binary cannot reach a parser.
              </li>
              <li>
                Parsed by pure-JavaScript libraries that treat the file as data. Nothing is executed, nothing is shelled
                out to, and DOCX macros are never evaluated.
              </li>
              <li>Filenames are stripped of path components and control characters before storage.</li>
              <li>Stored as private objects under tenant-scoped keys, and served only through an authenticated route.</li>
              <li>Your original upload is immutable — new versions are new records.</li>
            </ul>
          ),
        },
        {
          id: 'side-effects',
          heading: 'Outward-facing actions',
          body: (
            <>
              <p>Anything that leaves the system requires an explicit confirmation that shows what will happen:</p>
              <ul>
                <li>The exact recipient, subject, body and attachment are displayed before an email can be sent.</li>
                <li>
                  A send is written with an idempotency key, so a retry cannot deliver twice, and failures are never
                  silently retried.
                </li>
                <li>Daily caps, duplicate-recipient protection and a suppression list apply on every send.</li>
                <li>
                  Marking an application submitted is gated on the actor: only a direct user action can set it. The state
                  machine rejects any other path, so the product cannot claim you applied when you did not.
                </li>
                <li>Scheduled work prepares material and notifies you. It has no path to submitting an application.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'transport',
          heading: 'Transport and headers',
          body: (
            <ul>
              <li>A Content-Security-Policy restricting scripts, styles, frames and connections to this origin.</li>
              <li>
                <code className="font-mono text-sm">frame-ancestors: none</code> and{' '}
                <code className="font-mono text-sm">X-Frame-Options: DENY</code> — the app cannot be framed.
              </li>
              <li>HSTS, <code className="font-mono text-sm">nosniff</code>, a strict referrer policy, and a restrictive permissions policy.</li>
              <li>Session cookies are HTTP-only, SameSite=Lax, and Secure in production.</li>
              <li>Durable rate limits on sign-in, sign-up, password reset, uploads, AI tasks, imports and sends.</li>
            </ul>
          ),
        },
        {
          id: 'audit',
          heading: 'Audit log',
          body: (
            <p>
              Significant actions are recorded as append-only events: sign-in, resume upload and parse, analysis,
              suggestion decisions, version and PDF creation, job import, matching, packet generation, approval, portal
              opening, submission confirmation, outreach drafting and sending, schedule creation and execution, provider
              key changes, and account deletion. Events store summaries and identifiers — never keys, never full
              documents. You can search and filter them at <strong>/audit</strong>.
            </p>
          ),
        },
        {
          id: 'reporting',
          heading: 'Reporting a vulnerability',
          body: (
            <p>
              Email <a href="mailto:prot.das15@gmail.com">prot.das15@gmail.com</a> with enough
              detail to reproduce. Please do not test against other people’s accounts. If you run your own deployment,
              replace this with your own contact address. See also our{' '}
              <Link href="/privacy">privacy policy</Link>.
            </p>
          ),
        },
      ]}
    />
  );
}
