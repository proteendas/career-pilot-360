/**
 * Email provider abstraction. Server-only.
 *
 * Two concerns are deliberately separated:
 *  - TRANSACTIONAL mail (verify address, reset password) is sent by the app.
 *  - OUTREACH mail (a cold email to a recruiter) is sent only after an explicit,
 *    per-message user confirmation and is subject to suppression lists and
 *    daily caps. See src/lib/outreach/send.ts - never call `send()` directly
 *    for outreach.
 *
 * Drivers:
 *  - `console` (default): writes the message to the server log. Nothing leaves
 *    the machine. Local development and CI use this.
 *  - `resend`: real delivery via Resend's HTTP API.
 *
 * Gmail / Microsoft OAuth "send on behalf of the user" is the preferred
 * production path for outreach; it is modelled as a future driver behind this
 * same interface (see `docs/adapters.md`). No driver ever asks for the user's
 * email password.
 */
import { env, featureFlags } from '@/lib/env';

export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

export interface SendEmailInput {
  to: string;
  from?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  /** Deduplicates retries at the provider boundary. */
  idempotencyKey?: string;
}

export interface SendEmailResult {
  ok: boolean;
  providerMessageId: string | null;
  provider: string;
  error?: string;
  /** True when the message was logged instead of delivered. */
  simulated?: boolean;
}

export interface EmailProvider {
  readonly id: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export function isValidEmail(value: string): boolean {
  const s = (value ?? '').trim();
  if (s.length < 6 || s.length > 254) return false;
  if (/\s/.test(s)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(s);
}

class ConsoleEmailProvider implements EmailProvider {
  readonly id = 'console';

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const id = `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.info(
      [
        '',
        '──────────── CareerPilot360 · simulated email ────────────',
        `to:      ${input.to}`,
        `from:    ${input.from ?? env().EMAIL_FROM ?? 'careerpilot360@localhost'}`,
        `subject: ${input.subject}`,
        input.attachments?.length ? `attach:  ${input.attachments.map((a) => a.filename).join(', ')}` : null,
        '─────────────────────────────────────────────────────────',
        input.text,
        '─────────────────────── end of message ──────────────────',
        '',
      ]
        .filter((l) => l !== null)
        .join('\n'),
    );
    return { ok: true, providerMessageId: id, provider: this.id, simulated: true };
  }
}

class ResendEmailProvider implements EmailProvider {
  readonly id = 'resend';

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const e = env();
    if (!e.RESEND_API_KEY || !e.EMAIL_FROM) {
      return {
        ok: false,
        providerMessageId: null,
        provider: this.id,
        error: 'RESEND_API_KEY and EMAIL_FROM must both be set to send email.',
      };
    }
    try {
      const { Resend } = await import('resend');
      const client = new Resend(e.RESEND_API_KEY);
      const res = await client.emails.send({
        from: input.from ?? e.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((a) => ({
                filename: a.filename,
                content: Buffer.from(a.content).toString('base64'),
                contentType: a.contentType,
              })),
            }
          : {}),
        ...(input.idempotencyKey ? { headers: { 'X-Entity-Ref-ID': input.idempotencyKey } } : {}),
      });
      if (res.error) {
        return { ok: false, providerMessageId: null, provider: this.id, error: res.error.message };
      }
      return { ok: true, providerMessageId: res.data?.id ?? null, provider: this.id };
    } catch (err) {
      return {
        ok: false,
        providerMessageId: null,
        provider: this.id,
        error: err instanceof Error ? err.message : 'Unknown email provider error.',
      };
    }
  }
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  provider = env().EMAIL_PROVIDER === 'resend' ? new ResendEmailProvider() : new ConsoleEmailProvider();
  return provider;
}

/** Test-only override. */
export function __setEmailProvider(p: EmailProvider | null): void {
  provider = p;
}

/** True when real delivery is configured; the UI must say so honestly. */
export function canSendRealEmail(): boolean {
  return featureFlags().emailSending;
}

/* ------------------------------------------------- transactional helpers -- */

function shell(title: string, bodyLines: string[], cta?: { label: string; url: string }): string {
  return [
    `${title}`,
    '',
    ...bodyLines,
    ...(cta ? ['', `${cta.label}: ${cta.url}`] : []),
    '',
    '—',
    'CareerPilot360 · you are receiving this because an account was created with this address.',
    'CareerPilot360 never asks for your LinkedIn, Naukri or job-portal password.',
  ].join('\n');
}

export async function sendVerificationEmail(to: string, url: string): Promise<SendEmailResult> {
  return getEmailProvider().send({
    to,
    subject: 'Verify your CareerPilot360 email address',
    text: shell(
      'Confirm your email address',
      [
        'Verifying your address unlocks resume analysis, job matching and recruiter outreach.',
        'This link expires in 24 hours and can be used once.',
      ],
      { label: 'Verify', url },
    ),
  });
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<SendEmailResult> {
  return getEmailProvider().send({
    to,
    subject: 'Reset your CareerPilot360 password',
    text: shell(
      'Reset your password',
      [
        'If you asked to reset your password, use the link below. It expires in 60 minutes.',
        'If you did not request this, you can safely ignore this email - nothing has changed.',
      ],
      { label: 'Reset password', url },
    ),
  });
}
