/**
 * The single funnel for untrusted input.
 *
 * Modelled on graphify's `security.py`: every piece of external data - a
 * user-supplied job URL, fetched HTML, an uploaded file, an imported label -
 * passes through a function in THIS module before any other code touches it.
 * If you find yourself calling `fetch()` on a user-controlled URL anywhere
 * else, that is a bug.
 *
 * Guarantees:
 *  - `validateUrl`    : http/https only, no credentials, no private/loopback hosts (SSRF)
 *  - `safeFetch`      : size cap, timeout, per-hop redirect re-validation, no cookies
 *  - `sanitizeLabel`  : control chars stripped, length capped
 *  - `validateUpload` : extension + magic-byte sniffing + size cap
 */

export class SecurityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ URLs -- */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

/** Host suffixes that must never be fetched, even if DNS would resolve them. */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.cluster.local'];

/**
 * True when the host is a bare IP address rather than a hostname.
 *
 * We refuse ALL IP literals, not just private ranges. Every source this product
 * talks to is addressed by hostname, so an IP literal has no legitimate use
 * here — and allowing public ones means re-deriving the private-range rules for
 * every notation the URL parser accepts. Node normalises
 * `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, and decimal (`2130706433`) and
 * octal forms exist too; a single rule covers all of them.
 */
function isIpLiteral(host: string): boolean {
  // IPv6 literals keep their brackets in `URL.hostname`.
  if (host.startsWith('[')) return true;
  // Dotted quad, or any all-numeric form the parser may have accepted.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (/^\d+$/.test(host)) return true;
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  return false;
}

export interface ValidatedUrl {
  url: URL;
  href: string;
  hostname: string;
}

/**
 * Validate a user-provided URL for storage or fetching.
 * Throws {@link SecurityError} when the URL is not safe to touch.
 */
export function validateUrl(raw: string, opts: { allowedHosts?: string[] } = {}): ValidatedUrl {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) throw new SecurityError('url_empty', 'URL is required.');
  if (trimmed.length > 2048) throw new SecurityError('url_too_long', 'URL is too long.');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SecurityError('url_invalid', 'That does not look like a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SecurityError('url_scheme', 'Only http:// and https:// URLs are supported.');
  }
  if (url.username || url.password) {
    throw new SecurityError('url_credentials', 'URLs containing credentials are not accepted.');
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SecurityError('url_private_host', 'That host cannot be reached from CareerPilot360.');
  }
  if (isIpLiteral(host)) {
    throw new SecurityError(
      'url_private_host',
      'Enter a URL with a hostname. Raw IP addresses are not accepted.',
    );
  }
  if (!host.includes('.')) {
    throw new SecurityError('url_private_host', 'A fully-qualified public hostname is required.');
  }

  if (opts.allowedHosts?.length) {
    const ok = opts.allowedHosts.some((a) => {
      const allowed = a.toLowerCase();
      return host === allowed || host.endsWith(`.${allowed}`);
    });
    if (!ok) throw new SecurityError('url_not_allowlisted', `${host} is not on the allowlist for this operation.`);
  }

  return { url, href: url.toString(), hostname: host };
}

/** True when the URL is safe. Never throws - for form-level validation. */
export function isSafeUrl(raw: string, opts?: { allowedHosts?: string[] }): boolean {
  try {
    validateUrl(raw, opts ?? {});
    return true;
  } catch {
    return false;
  }
}

export interface SafeFetchOptions {
  allowedHosts?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  accept?: string;
  method?: 'GET' | 'POST';
  body?: string;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
  truncated: boolean;
}

const DEFAULT_MAX_BYTES = 1_500_000;
const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Fetch an external URL with SSRF protection, a hard byte cap and a timeout.
 * Redirects are followed manually so every hop is re-validated.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? 3;
  const allowOpts = opts.allowedHosts ? { allowedHosts: opts.allowedHosts } : {};

  let current = validateUrl(rawUrl, allowOpts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await fetch(current.href, {
        method: opts.method ?? 'GET',
        redirect: 'manual',
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          accept: opts.accept ?? 'text/html,application/json;q=0.9,*/*;q=0.8',
          'user-agent': 'CareerPilot360/1.0 (compliant job import)',
          ...(opts.body ? { 'content-type': 'application/json' } : {}),
          ...opts.headers,
        },
        ...(opts.body ? { body: opts.body } : {}),
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new SecurityError('fetch_bad_redirect', 'Redirect without a target.');
        if (hop === maxRedirects) throw new SecurityError('fetch_too_many_redirects', 'Too many redirects.');
        current = validateUrl(new URL(loc, current.href).toString(), allowOpts);
        continue;
      }

      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared && declared > maxBytes) {
        throw new SecurityError('fetch_too_large', 'The remote document is too large to import.');
      }

      const { text, truncated } = await readCapped(res, maxBytes);
      return {
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        body: text,
        finalUrl: current.href,
        truncated,
      };
    }
    throw new SecurityError('fetch_too_many_redirects', 'Too many redirects.');
  } catch (err) {
    if (err instanceof SecurityError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SecurityError('fetch_timeout', 'The remote server took too long to respond.');
    }
    throw new SecurityError('fetch_failed', 'Could not reach that URL.');
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      const keep = value.byteLength - (total - maxBytes);
      if (keep > 0) chunks.push(value.slice(0, keep));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(merged), truncated };
}

/* ---------------------------------------------------------------- labels -- */

 
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const CONTROL_CHARS_AND_NEWLINES = /[\x00-\x1f\x7f]/g;
 

/** Zero-width and bidi characters often used to hide prompt-injection payloads. */
const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁤﻿]/g;

/** Strip control characters and cap length. Use for any imported free-text label. */
export function sanitizeLabel(raw: string, maxLength = 256): string {
  return (raw ?? '')
    .replace(CONTROL_CHARS_AND_NEWLINES, ' ')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Normalise imported long-form text (resume body, job description).
 * Keeps line structure but removes control characters and zero-width tricks
 * used to smuggle instructions past a human reviewer's eyes.
 */
export function sanitizeImportedText(raw: string, maxLength = 200_000): string {
  return (raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .slice(0, maxLength);
}

/** Strip HTML tags from fetched markup, preserving block structure as newlines. */
export function htmlToText(html: string): string {
  const withoutScripts = (html ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const blocked = withoutScripts
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|ul|ol|table|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ');
  const text = blocked.replace(/<[^>]+>/g, ' ');
  return sanitizeImportedText(decodeEntities(text))
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && (arr[i - 1] ?? '').length > 0))
    .join('\n')
    .trim();
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-',
    rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...', bull: '•', middot: '·',
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n: string) => named[n.toLowerCase()] ?? m);
}

function safeCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 32 || cp > 0x10ffff) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/* --------------------------------------------------------------- uploads -- */

export const RESUME_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export type UploadKind = 'pdf' | 'docx';

export interface ValidatedUpload {
  kind: UploadKind;
  mimeType: string;
  filename: string;
  size: number;
  bytes: Uint8Array;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b]; // PK - DOCX is a zip container

/**
 * Validate an uploaded resume: extension AND magic bytes AND size, so a renamed
 * binary cannot reach the parsers.
 *
 * Virus-safe parsing strategy: the file is never executed and never shelled
 * out to. Bytes are handed only to pure-JS parsers (unpdf / mammoth) that treat
 * content as data; DOCX macros are never evaluated.
 */
export function validateUpload(
  file: { name: string; type: string; size: number },
  bytes: Uint8Array,
): ValidatedUpload {
  const filename = sanitizeFilename(file.name);
  const ext = filename.toLowerCase().split('.').pop() ?? '';

  if (bytes.byteLength === 0) throw new SecurityError('upload_empty', 'That file is empty.');
  if (bytes.byteLength > RESUME_MAX_BYTES) {
    throw new SecurityError('upload_too_large', 'Resume files must be 10 MB or smaller.');
  }

  const looksPdf = PDF_MAGIC.every((b, i) => bytes[i] === b);
  const looksZip = ZIP_MAGIC.every((b, i) => bytes[i] === b);

  if (ext === 'pdf') {
    if (!looksPdf) throw new SecurityError('upload_content_mismatch', 'That file is not a valid PDF.');
    return { kind: 'pdf', mimeType: 'application/pdf', filename, size: bytes.byteLength, bytes };
  }
  if (ext === 'docx') {
    if (!looksZip) throw new SecurityError('upload_content_mismatch', 'That file is not a valid DOCX.');
    return {
      kind: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename,
      size: bytes.byteLength,
      bytes,
    };
  }
  if (ext === 'doc') {
    throw new SecurityError('upload_legacy_doc', 'Legacy .doc files are not supported - upload a PDF or DOCX.');
  }
  throw new SecurityError('upload_type', 'Only PDF and DOCX resumes are supported.');
}

/** Remove path components and unsafe characters from an uploaded filename. */
export function sanitizeFilename(raw: string): string {
  const base = (raw ?? 'resume').split(/[/\\]/).pop() ?? 'resume';
  const cleaned = base
    .replace(CONTROL_CHARS_AND_NEWLINES, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || 'resume').slice(0, 180);
}

/* -------------------------------------------------------------- hashing --- */

/** Stable content hash used for dedupe and PDF provenance. */
export async function contentHash(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time comparison, used for CRON_SECRET and token checks. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a ?? '');
  const bb = new TextEncoder().encode(b ?? '');
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

/** Mask a secret for display. Never reveals more than the last 4 characters. */
export function maskSecret(secret: string): string {
  const s = (secret ?? '').trim();
  if (s.length <= 4) return '****';
  return `${'*'.repeat(Math.min(20, Math.max(4, s.length - 4)))}${s.slice(-4)}`;
}
