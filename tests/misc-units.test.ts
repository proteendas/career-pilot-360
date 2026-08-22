import { describe, expect, it } from 'vitest';
import { diffStats, diffWords } from '@/lib/diff';
import { redactMetadata, AUDIT_ACTIONS } from '@/lib/audit';
import { assessPassword, hashPassword, verifyPassword, PASSWORD_MIN_LENGTH } from '@/lib/auth/password';
import { emptyProfile, profileCompleteness, parseProfile, fullProfileSchema } from '@/lib/profile/types';
import { formatMoney, initials, scoreTone, truncate } from '@/lib/utils';
import { assertSafeStoragePath, resumeOriginalPath, StorageError } from '@/lib/storage';

describe('word diff', () => {
  it('reports an unchanged string as all equal', () => {
    const tokens = diffWords('hello world', 'hello world');
    expect(tokens).toEqual([{ type: 'equal', value: 'hello world' }]);
  });

  it('marks an inserted qualifier without touching the rest', () => {
    const tokens = diffWords('Worked on an ERP application', 'Developed modules for an ERP application');
    const rebuiltBefore = tokens.filter((t) => t.type !== 'insert').map((t) => t.value).join('');
    const rebuiltAfter = tokens.filter((t) => t.type !== 'delete').map((t) => t.value).join('');
    expect(rebuiltBefore).toBe('Worked on an ERP application');
    expect(rebuiltAfter).toBe('Developed modules for an ERP application');
  });

  it('is lossless for both sides in every case', () => {
    const cases: [string, string][] = [
      ['', 'added text'],
      ['removed text', ''],
      ['a b c', 'a c'],
      ['one', 'two'],
      ['keep  spacing   here', 'keep  spacing   there'],
    ];
    for (const [before, after] of cases) {
      const tokens = diffWords(before, after);
      expect(tokens.filter((t) => t.type !== 'insert').map((t) => t.value).join('')).toBe(before);
      expect(tokens.filter((t) => t.type !== 'delete').map((t) => t.value).join('')).toBe(after);
    }
  });

  it('merges adjacent tokens of the same type', () => {
    const tokens = diffWords('a', 'x y z');
    expect(tokens.filter((t) => t.type === 'insert')).toHaveLength(1);
  });

  it('falls back to a whole-block replace on pathological input', () => {
    const big = 'word '.repeat(3000);
    const tokens = diffWords(big, `${big}extra`);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('counts added and removed words', () => {
    const stats = diffStats('built the api', 'built the public api quickly');
    expect(stats.added).toBe(2);
    expect(stats.removed).toBe(0);
    expect(stats.changed).toBe(true);
    expect(diffStats('same', 'same').changed).toBe(false);
  });
});

describe('audit redaction', () => {
  it('replaces anything key-shaped', () => {
    const out = redactMetadata({
      apiKey: 'sk-live-123',
      api_key: 'sk-live-123',
      encryptedKey: 'v1.a.b.c',
      password: 'hunter2',
      authorization: 'Bearer abc',
      refreshToken: 'rt_123',
      provider: 'groq',
    }) as Record<string, unknown>;

    expect(out.apiKey).toBe('[redacted]');
    expect(out.api_key).toBe('[redacted]');
    expect(out.encryptedKey).toBe('[redacted]');
    expect(out.password).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect(out.refreshToken).toBe('[redacted]');
    // Non-sensitive context survives.
    expect(out.provider).toBe('groq');
  });

  it('replaces bulk document text with a length', () => {
    const out = redactMetadata({
      extractedText: 'x'.repeat(5000),
      coverLetter: 'Dear hiring manager…',
      jobDescription: 'y'.repeat(200),
    }) as Record<string, unknown>;

    expect(out.extractedText).toBeUndefined();
    expect(out.extractedTextLength).toBe(5000);
    expect(out.coverLetterLength).toBe(20);
    expect(out.jobDescriptionLength).toBe(200);
  });

  it('truncates long incidental strings', () => {
    const out = redactMetadata({ note: 'z'.repeat(1000) }) as Record<string, string>;
    const note = out.note ?? '';
    expect(note.length).toBeLessThan(400);
    expect(note).toContain('[+700 chars]');
  });

  it('redacts nested structures and caps depth', () => {
    const out = redactMetadata({ a: { b: { c: { d: { e: { f: 'deep' } } } } } }) as Record<string, unknown>;
    expect(JSON.stringify(out)).toContain('[truncated]');
  });

  it('caps array length', () => {
    const out = redactMetadata(Array.from({ length: 100 }, (_, i) => i)) as unknown[];
    expect(out).toHaveLength(40);
  });

  it('declares a unique action for every audited event', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });
});

describe('password policy', () => {
  it('rejects short, common and self-referential passwords', () => {
    expect(assessPassword('short').ok).toBe(false);
    expect(assessPassword('password123').ok).toBe(false);
    expect(assessPassword('aaaaaaaaaaaa').ok).toBe(false);
    expect(assessPassword('demo12345678', { email: 'demo@example.com' }).ok).toBe(false);
  });

  it('catches a name even when separators are used to disguise it', () => {
    // Each of these flattens to something containing a name token.
    for (const pw of ['priya-sharma-1', 'Priya.Sharma!99', 'sharma_is_great', 'p-r-i-y-a-sharma']) {
      const r = assessPassword(pw, { name: 'Priya Sharma' });
      expect(r.ok, pw).toBe(false);
      expect(r.problems.join(' ')).toMatch(/name/);
    }
  });

  it('catches an email local part disguised with separators', () => {
    const r = assessPassword('p-r-o-t-e-e-n-9999', { email: 'proteen@example.com' });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/email/);
  });

  it('does not flag a short name fragment that happens to appear', () => {
    // "Li" is only two characters, so it is not treated as a name token.
    expect(assessPassword('slightly-obscure-phrase', { name: 'Li Wei' }).ok).toBe(true);
  });

  it('accepts a long passphrase without symbol soup', () => {
    const r = assessPassword('correct horse battery staple');
    expect(r.ok).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(3);
  });

  it('accepts a shorter password that mixes character classes', () => {
    const r = assessPassword('Tr0ubador!x');
    expect(r.ok).toBe(true);
    expect(r.problems).toHaveLength(0);
  });

  it('never reports ok with a problem attached', () => {
    for (const pw of ['x', 'password', 'abcdefghij', 'Tr0ubador!x', 'a'.repeat(250)]) {
      const r = assessPassword(pw);
      if (r.ok) expect(r.problems).toHaveLength(0);
      else expect(r.problems.length).toBeGreaterThan(0);
    }
  });

  it('enforces the documented minimum length', () => {
    expect(assessPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)).ok).toBe(false);
  });

  it('hashes and verifies a password, and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password entirely', hash)).resolves.toBe(false);
  });

  it('returns false rather than throwing for a missing or malformed hash', async () => {
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });
});

describe('profile completeness', () => {
  it('scores an empty profile at zero', () => {
    const c = profileCompleteness(emptyProfile());
    expect(c.score).toBe(0);
    expect(c.missingForMatching.length).toBeGreaterThan(0);
  });

  it('scores a fully-populated profile at 100', () => {
    const profile = fullProfileSchema.parse({
      personal: {
        fullName: 'Priya Sharma',
        email: 'priya@example.com',
        phone: '+91 98765 43210',
        city: 'Bengaluru',
        country: 'India',
      },
      professional: {
        currentTitle: 'Senior Backend Engineer',
        targetTitles: ['Staff Engineer'],
        yearsOfExperience: 7,
        skills: ['TypeScript', 'PostgreSQL', 'Kafka', 'AWS', 'Docker'],
        professionalSummary: 'Backend engineer.',
        education: [{ degree: 'B.E.', institution: 'Anna University' }],
      },
      jobPreferences: {
        preferredLocations: ['Bengaluru'],
        minExpectedCtc: 4_000_000,
        noticePeriodDays: 60,
        workAuthorization: 'citizen',
      },
      applicationProfile: {},
    });

    const c = profileCompleteness(profile);
    expect(c.score).toBe(100);
    expect(c.missingForMatching).toEqual([]);
    expect(c.missingForApplying).toEqual([]);
  });

  it('requires at least five skills before crediting the skills item', () => {
    const profile = emptyProfile();
    profile.professional.skills = ['TypeScript', 'SQL'];
    const item = profileCompleteness(profile).items.find((i) => i.key === 'skills');
    expect(item?.done).toBe(false);
  });

  it('distinguishes what blocks matching from what blocks applying', () => {
    const profile = emptyProfile();
    profile.professional.targetTitles = ['Backend Engineer'];
    profile.professional.skills = ['a', 'b', 'c', 'd', 'e'];
    profile.professional.yearsOfExperience = 5;
    profile.personal.city = 'Pune';
    profile.personal.country = 'India';
    profile.jobPreferences.preferredLocations = ['Pune'];

    const c = profileCompleteness(profile);
    expect(c.missingForMatching).toEqual([]);
    expect(c.missingForApplying).toContain('Contact email');
  });

  it('treats a zero expected CTC as provided, not missing', () => {
    const profile = emptyProfile();
    profile.jobPreferences.minExpectedCtc = 0;
    const item = profileCompleteness(profile).items.find((i) => i.key === 'ctc');
    expect(item?.done).toBe(true);
  });

  it('survives malformed stored data by falling back to defaults', () => {
    const parsed = parseProfile({ personal: 'not an object', professional: null });
    expect(parsed.personal.fullName).toBe('');
    expect(parsed.professional.skills).toEqual([]);
  });

  it('normalises a bare domain into an https URL', () => {
    const parsed = parseProfile({ professional: { githubUrl: 'github.com/example' } });
    expect(parsed.professional.githubUrl).toBe('https://github.com/example');
  });
});

describe('storage path safety', () => {
  it('accepts tenant-scoped keys', () => {
    const p = resumeOriginalPath('11111111-2222-3333-4444-555555555555', 'doc-1', 'cv.pdf');
    expect(assertSafeStoragePath(p)).toBe(p);
  });

  it.each(['../secrets', '/etc/passwd', 'a/../../b', 'a\\b', ''])('rejects %s', (bad) => {
    expect(() => assertSafeStoragePath(bad)).toThrow(StorageError);
  });
});

describe('formatting helpers', () => {
  it('formats Indian CTC at lakh and crore scale', () => {
    expect(formatMoney(4_000_000, 'INR')).toBe('₹40.0 L');
    expect(formatMoney(15_000_000, 'INR')).toBe('₹1.50 Cr');
    expect(formatMoney(50_000, 'INR')).toBe('₹50,000');
  });

  it('formats other currencies compactly', () => {
    expect(formatMoney(120_000, 'USD')).toBe('$120k');
    expect(formatMoney(null)).toBe('—');
  });

  it('derives initials safely', () => {
    expect(initials('Priya Sharma')).toBe('PS');
    expect(initials('Priya')).toBe('PR');
    expect(initials('')).toBe('U');
    expect(initials(null)).toBe('U');
  });

  it('maps scores to tones at the documented thresholds', () => {
    expect(scoreTone(75)).toBe('success');
    expect(scoreTone(74)).toBe('warning');
    expect(scoreTone(50)).toBe('warning');
    expect(scoreTone(49)).toBe('danger');
  });

  it('truncates with an ellipsis only when needed', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a much longer string', 10)).toHaveLength(10);
  });
});
