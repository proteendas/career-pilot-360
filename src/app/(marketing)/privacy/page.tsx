import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/marketing/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What CareerPilot360 stores, why, where it goes, and how to get it back or delete it.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="1 August 2026"
      intro={
        <>
          <p>
            This describes what CareerPilot360 stores, why it stores it, who it is shared with, and how you remove it.
            It is written to be read rather than to be defensible.
          </p>
          <p className="mt-3">
            One thing worth stating up front: CareerPilot360 never asks for, and cannot accept, your password for
            LinkedIn, Naukri, or any other job portal. There is no feature that would use one.
          </p>
        </>
      }
      sections={[
        {
          id: 'what-we-store',
          heading: 'What we store',
          body: (
            <>
              <ul>
                <li>
                  <strong>Account</strong> — email address, a bcrypt hash of your password (never the password itself),
                  your name, and an optional avatar URL.
                </li>
                <li>
                  <strong>Profile</strong> — the personal, professional, job-preference and application-answer
                  information you enter. This is the material the matching engine and packet generator are permitted to
                  use.
                </li>
                <li>
                  <strong>Resumes</strong> — your uploaded file, the text extracted from it, and each version you
                  create. Original uploads are preserved and never overwritten.
                </li>
                <li>
                  <strong>Jobs and applications</strong> — jobs you import or discover, match scores and their
                  breakdowns, generated packets, application statuses, and the events behind each status change.
                </li>
                <li>
                  <strong>Outreach</strong> — recruiter contacts you enter, the drafts generated for them, and a record
                  of any message you confirmed sending.
                </li>
                <li>
                  <strong>AI provider keys</strong> — encrypted with AES-256-GCM. We store the ciphertext and a masked
                  preview showing the last four characters. The plaintext key is never returned to the browser after you
                  save it, and is never included in an export.
                </li>
                <li>
                  <strong>Audit events</strong> — an append-only record of significant actions. These store summaries
                  and identifiers, never API keys and never full document content.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'what-we-dont',
          heading: 'What we deliberately do not do',
          body: (
            <ul>
              <li>We do not scrape LinkedIn, Naukri, Indeed, Glassdoor or any other job platform.</li>
              <li>We do not collect or store job-portal credentials, and no feature could use them.</li>
              <li>We do not drive a logged-in account with browser automation.</li>
              <li>We do not scrape recruiter profiles, contact databases, or private messages.</li>
              <li>We do not guess or infer email addresses.</li>
              <li>We do not send email on your behalf without a per-message confirmation from you.</li>
              <li>We do not put resume content or job descriptions into analytics.</li>
              <li>We do not sell or rent your personal data. There is no advertising in this product.</li>
            </ul>
          ),
        },
        {
          id: 'ai-processing',
          heading: 'AI processing',
          body: (
            <>
              <p>
                When you run an AI-assisted task, the relevant text — resume sections, a job description, your profile
                fields — is sent to the AI provider <em>you</em> configured, using <em>your</em> API key. That provider
                processes it under their own terms, which you should read; we cannot make commitments on their behalf.
              </p>
              <p>
                Two categories are excluded from AI requests entirely: the optional demographic fields
                (pronouns, disability or diversity information) and your date of birth. These are never used for
                matching or scoring and are never sent to a provider.
              </p>
              <p>
                The deterministic parts of the product — ATS scoring, keyword coverage, resume validation, deduplication
                and the match score itself — run on our own servers with no AI provider involved. You can use
                CareerPilot360 with no AI key at all.
              </p>
              <p>
                Every AI output is a draft for you to review. It can be wrong, and it can sound more confident than the
                evidence supports.
              </p>
            </>
          ),
        },
        {
          id: 'storage-and-security',
          heading: 'Storage and security',
          body: (
            <>
              <ul>
                <li>Data is held in a PostgreSQL database with strict per-user isolation on every query.</li>
                <li>
                  Documents are stored as private objects and streamed back only through an authenticated route. They
                  are not publicly addressable.
                </li>
                <li>Passwords are hashed with bcrypt at cost 12. We cannot read your password.</li>
                <li>Provider keys are encrypted at rest and decrypted only inside server-side execution.</li>
                <li>Session cookies are HTTP-only and, in production, Secure.</li>
                <li>
                  Any URL you paste is fetched through an SSRF-protected client with a byte cap, a timeout, and
                  re-validation on every redirect. Private and internal network addresses are refused.
                </li>
                <li>Rate limits apply to sign-in, uploads, AI tasks and email sends.</li>
              </ul>
              <p>
                See <Link href="/security">the security page</Link> for the specifics.
              </p>
            </>
          ),
        },
        {
          id: 'retention',
          heading: 'Retention',
          body: (
            <p>
              By default your data is kept until you delete it. You can set a retention window in{' '}
              <strong>Settings → Security &amp; privacy</strong>, after which a scheduled cleanup task removes older
              records. Audit events are retained for their own integrity: they are append-only, and are removed when the
              account is deleted.
            </p>
          ),
        },
        {
          id: 'data-deletion',
          heading: 'Data deletion',
          body: (
            <>
              <p>
                Go to <strong>Settings → Security &amp; privacy → Delete account</strong>. You will be shown exactly
                what is removed and asked to type <code className="font-mono text-sm">DELETE</code> to confirm.
              </p>
              <p>Deletion removes:</p>
              <ul>
                <li>Your stored resume files and every generated PDF, from the storage provider.</li>
                <li>
                  Your account row, and — by database cascade — your profile, resume versions, suggestions, imported
                  jobs, matches, packets, applications, events, contacts, drafts, sends, schedules, queued tasks,
                  provider keys, conversations and audit events.
                </li>
              </ul>
              <p>
                One record survives: a single audit event noting that an account was deleted, with the former account
                identifier and no personal data. That exists so the deletion itself remains provable.
              </p>
              <p>This is a hard delete, not a flag. It cannot be undone.</p>
            </>
          ),
        },
        {
          id: 'export',
          heading: 'Exporting your data',
          body: (
            <p>
              <strong>Settings → Security &amp; privacy → Export data</strong> produces a JSON file containing
              everything listed above. Provider API keys are excluded by design — only the masked preview appears —
              because the plaintext must never leave the encryption boundary.
            </p>
          ),
        },
        {
          id: 'india',
          heading: 'India and the DPDP Act',
          body: (
            <>
              <p>
                CareerPilot360 is designed with Indian data-protection obligations in mind: data minimisation, purpose
                limitation, consent records, configurable retention, export, and genuine deletion.
              </p>
              <p>
                We deliberately do not claim automatic legal compliance. Whether a particular deployment satisfies the
                DPDP Act depends on how it is operated, which processors are configured, and where data is hosted — none
                of which this document can settle for you. If you are deploying CareerPilot360 for others, take your own
                advice.
              </p>
            </>
          ),
        },
        {
          id: 'contact',
          heading: 'Contact',
          body: (
            <p>
              Questions, or a request about your data:{' '}
              <a href="mailto:prot.das15@gmail.com">prot.das15@gmail.com</a>. If you are running
              your own deployment, replace this address with your own operator contact.
            </p>
          ),
        },
      ]}
    />
  );
}
