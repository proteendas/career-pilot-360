import { describe, expect, it, vi } from 'vitest';
import {
  contentHash,
  htmlToText,
  isSafeUrl,
  maskSecret,
  sanitizeFilename,
  sanitizeImportedText,
  sanitizeLabel,
  SecurityError,
  safeFetch,
  timingSafeEqual,
  validateUpload,
  validateUrl,
} from '@/lib/security';

describe('validateUrl', () => {
  it('accepts ordinary public https URLs', () => {
    const v = validateUrl('https://boards.greenhouse.io/acme/jobs/123');
    expect(v.hostname).toBe('boards.greenhouse.io');
  });

  it.each([
    ['file:///etc/passwd', 'url_scheme'],
    ['javascript:alert(1)', 'url_scheme'],
    ['http://user:pass@example.com', 'url_credentials'],
    ['http://localhost:3000/x', 'url_private_host'],
    ['http://127.0.0.1/x', 'url_private_host'],
    ['http://10.1.2.3/x', 'url_private_host'],
    ['http://172.16.0.1/x', 'url_private_host'],
    ['http://192.168.1.1/x', 'url_private_host'],
    ['http://169.254.169.254/latest/meta-data', 'url_private_host'],
    ['http://100.64.0.1/x', 'url_private_host'],
    ['http://metadata.google.internal/x', 'url_private_host'],
    ['http://[::1]/x', 'url_private_host'],
    ['http://build.local/x', 'url_private_host'],
    ['http://intranet/x', 'url_private_host'],
    ['', 'url_empty'],
    ['not a url', 'url_invalid'],
  ])('rejects %s', (input, code) => {
    try {
      validateUrl(input);
      throw new Error(`expected ${input} to be rejected`);
    } catch (err) {
      expect(err).toBeInstanceOf(SecurityError);
      expect((err as SecurityError).code).toBe(code);
    }
  });

  it.each([
    'http://[::ffff:127.0.0.1]/x', // normalised by the parser to hex form
    'http://[::1]/x',
    'http://[fe80::1]/x',
    'http://[fd00::1]/x',
    'http://2130706433/x', // decimal encoding of 127.0.0.1
    'http://0x7f000001/x', // hex encoding of 127.0.0.1
    'http://8.8.8.8/x', // public, but still a raw IP: refused by policy
  ])('refuses the IP literal %s', (input) => {
    expect(isSafeUrl(input)).toBe(false);
  });

  it('enforces an allowlist when one is given', () => {
    expect(isSafeUrl('https://evil.example/x', { allowedHosts: ['api.lever.co'] })).toBe(false);
    expect(isSafeUrl('https://api.lever.co/v0/postings/acme', { allowedHosts: ['api.lever.co'] })).toBe(true);
    // Subdomains of an allowed host are permitted.
    expect(isSafeUrl('https://eu.api.lever.co/x', { allowedHosts: ['api.lever.co'] })).toBe(true);
  });

  it('rejects an over-long URL', () => {
    expect(isSafeUrl(`https://example.com/${'a'.repeat(2100)}`)).toBe(false);
  });
});

describe('safeFetch', () => {
  it('re-validates every redirect hop, so a public URL cannot redirect inward', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
    );

    await expect(safeFetch('https://example.com/job')).rejects.toMatchObject({ code: 'url_private_host' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a response that declares a size over the cap', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('x', { status: 200, headers: { 'content-length': '99999999' } }),
    );
    await expect(safeFetch('https://example.com/job', { maxBytes: 100 })).rejects.toMatchObject({
      code: 'fetch_too_large',
    });
  });

  it('truncates a body that exceeds the cap mid-stream', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('a'.repeat(500), { status: 200 }));
    const res = await safeFetch('https://example.com/job', { maxBytes: 100 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(100);
  });

  it('surfaces a timeout as a SecurityError rather than an AbortError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          setTimeout(() => reject(err), 5);
        }),
    );
    await expect(safeFetch('https://example.com/job', { timeoutMs: 1 })).rejects.toMatchObject({
      code: 'fetch_timeout',
    });
  });
});

describe('sanitizers', () => {
  it('strips control characters from labels', () => {
    expect(sanitizeLabel(`Senior\u0000\u001b[31m Engineer`)).toBe('Senior [31m Engineer');
  });

  it('collapses newlines in a label', () => {
    expect(sanitizeLabel('Senior\nBackend\tEngineer')).toBe('Senior Backend Engineer');
  });

  it('removes zero-width and bidi characters used to hide prompt injection', () => {
    const hidden = `Normal text\u200bIGNORE PREVIOUS\u202e reversed\ufeff`;
    const out = sanitizeImportedText(hidden);
    expect(out).not.toContain('\u200b');
    expect(out).not.toContain('\u202e');
    expect(out).not.toContain('\ufeff');
    expect(out).toContain('Normal text');
  });

  it('preserves paragraph structure in imported text', () => {
    expect(sanitizeImportedText('a\r\nb\n\n\n\n\nc')).toBe('a\nb\n\n\nc');
  });

  it('caps imported text length', () => {
    expect(sanitizeImportedText('x'.repeat(500), 100)).toHaveLength(100);
  });

  it('converts HTML to text without leaving tags or scripts', () => {
    const html = [
      '<html><head><style>.a{color:red}</style></head>',
      "<body><script>fetch('/steal')</script>",
      '<h1>Senior Engineer</h1><p>Build&nbsp;things</p>',
      '<ul><li>PostgreSQL</li><li>Kafka</li></ul></body></html>',
    ].join('\n');
    const text = htmlToText(html);
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text).not.toContain('fetch');
    expect(text).not.toContain('color:red');
    expect(text).toContain('Senior Engineer');
    expect(text).toContain('Build things');
    expect(text).toContain('PostgreSQL');
  });

  it('decodes numeric entities but drops control code points', () => {
    expect(htmlToText('<p>A&#38;B&#x26;C&#0;</p>')).toBe('A&B&C');
  });

  it('strips path traversal from filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\me\\cv.pdf')).toBe('cv.pdf');
    expect(sanitizeFilename('')).toBe('resume');
    expect(sanitizeFilename('...hidden.pdf')).toBe('hidden.pdf');
  });
});

describe('validateUpload', () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);

  it('accepts a real PDF', () => {
    const r = validateUpload({ name: 'cv.pdf', type: 'application/pdf', size: 6 }, pdfBytes);
    expect(r.kind).toBe('pdf');
    expect(r.mimeType).toBe('application/pdf');
  });

  it('accepts a real DOCX', () => {
    const r = validateUpload({ name: 'cv.docx', type: '', size: 5 }, zipBytes);
    expect(r.kind).toBe('docx');
  });

  it('rejects a renamed file whose magic bytes disagree with its extension', () => {
    expect(() => validateUpload({ name: 'cv.pdf', type: 'application/pdf', size: 5 }, zipBytes)).toThrow(
      /not a valid PDF/,
    );
    expect(() => validateUpload({ name: 'cv.docx', type: '', size: 5 }, pdfBytes)).toThrow(/not a valid DOCX/);
  });

  it('rejects unsupported and legacy formats', () => {
    expect(() => validateUpload({ name: 'cv.exe', type: '', size: 5 }, pdfBytes)).toThrow(/Only PDF and DOCX/);
    expect(() => validateUpload({ name: 'cv.doc', type: '', size: 5 }, pdfBytes)).toThrow(/Legacy/);
  });

  it('rejects empty and oversized files', () => {
    expect(() => validateUpload({ name: 'cv.pdf', type: '', size: 0 }, new Uint8Array())).toThrow(/empty/);
    const big = new Uint8Array(2 * 1024 * 1024);
    big.set(pdfBytes);
    expect(() => validateUpload({ name: 'cv.pdf', type: '', size: big.length }, big)).toThrow(/1 MB/);
  });
});

describe('hashing helpers', () => {
  it('produces a stable sha-256 hex digest', async () => {
    await expect(contentHash('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes identical content to the same value regardless of input type', async () => {
    const fromString = await contentHash('hello');
    const fromBytes = await contentHash(new TextEncoder().encode('hello'));
    expect(fromString).toBe(fromBytes);
  });

  it('compares in constant time and rejects length mismatch', () => {
    expect(timingSafeEqual('secret', 'secret')).toBe(true);
    expect(timingSafeEqual('secret', 'secreT')).toBe(false);
    expect(timingSafeEqual('secret', 'secret-longer')).toBe(false);
  });

  it('never reveals more than the last four characters of a secret', () => {
    const masked = maskSecret('sk-proj-abcdefghijklmnop1234');
    expect(masked.endsWith('1234')).toBe(true);
    expect(masked).not.toContain('abcdefgh');
    expect(maskSecret('ab')).toBe('****');
  });
});
