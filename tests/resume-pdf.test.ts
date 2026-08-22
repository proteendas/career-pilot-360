import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { generateResumePdf, RESUME_TEMPLATES, TEMPLATE_META, isResumeTemplate } from '@/lib/resume/pdf';
import { normalizeResumeText } from '@/lib/resume/normalize';
import { extractText } from '@/lib/resume/parse';
import { emptyResume } from '@/lib/resume/types';
import { optimizePdfBytes } from '@/lib/resume/optimize';
import { STRONG_RESUME } from './fixtures/resumes';

const resume = normalizeResumeText(STRONG_RESUME).resume;

describe('PDF generation', () => {
  it('produces a valid PDF for every template', async () => {
    for (const template of RESUME_TEMPLATES) {
      const result = await generateResumePdf(resume, { template });
      expect(result.template, template).toBe(template);
      expect(result.pageCount, template).toBeGreaterThanOrEqual(1);
      expect(result.bytes.byteLength, template).toBeGreaterThan(1000);
      // %PDF magic bytes.
      expect(Array.from(result.bytes.slice(0, 4)), template).toEqual([0x25, 0x50, 0x44, 0x46]);
      expect(result.contentHash, template).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('has metadata for every template', () => {
    for (const t of RESUME_TEMPLATES) {
      expect(TEMPLATE_META[t].label.length).toBeGreaterThan(0);
      expect(TEMPLATE_META[t].atsNote.length).toBeGreaterThan(0);
    }
    expect(isResumeTemplate('modern')).toBe(true);
    expect(isResumeTemplate('fancy')).toBe(false);
  });

  it('is byte-stable for identical input, so the hash identifies content', async () => {
    const a = await generateResumePdf(resume, { template: 'modern' });
    const b = await generateResumePdf(resume, { template: 'modern' });
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('produces a different hash when the content changes', async () => {
    const a = await generateResumePdf(resume, { template: 'modern' });
    const edited = structuredClone(resume);
    edited.summary = 'A different summary entirely.';
    const b = await generateResumePdf(edited, { template: 'modern' });
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('handles an empty resume without throwing', async () => {
    const result = await generateResumePdf(emptyResume(), { template: 'ats_safe' });
    expect(result.pageCount).toBe(1);
  });

  it('honours margin, font size and line spacing', async () => {
    const tight = await generateResumePdf(resume, { fontSize: 8, lineSpacing: 1.05, margin: 28 });
    const loose = await generateResumePdf(resume, { fontSize: 12, lineSpacing: 1.8, margin: 80 });
    expect(loose.pageCount).toBeGreaterThanOrEqual(tight.pageCount);
  });

  it('clamps out-of-range options rather than producing broken output', async () => {
    const result = await generateResumePdf(resume, { fontSize: 900, margin: -50, lineSpacing: 99 });
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
  });

  it('reports when single-page mode could not be honoured', async () => {
    const long = structuredClone(resume);
    // Force overflow with genuine content rather than by trimming.
    long.experience = Array.from({ length: 12 }, (_, i) => ({
      ...resume.experience[0]!,
      title: `Senior Engineer ${i}`,
      company: `Company ${i}`,
    }));
    const result = await generateResumePdf(long, { pageMode: 'single' });
    expect(result.pageCount).toBeGreaterThan(1);
    expect(result.truncated).toBe(true);
  });

  it('can omit optional sections', async () => {
    const full = await generateResumePdf(resume, { template: 'modern' });
    const trimmed = await generateResumePdf(resume, {
      template: 'modern',
      includeProjects: false,
      includeAwards: false,
      includeCertifications: false,
    });
    expect(trimmed.contentHash).not.toBe(full.contentHash);
  });

  it('accepts a custom accent colour and ignores a malformed one', async () => {
    const good = await generateResumePdf(resume, { template: 'modern', accentColor: '#2563eb' });
    const bad = await generateResumePdf(resume, { template: 'modern', accentColor: 'not-a-colour' });
    const dflt = await generateResumePdf(resume, { template: 'modern' });
    expect(good.bytes.byteLength).toBeGreaterThan(1000);
    // A malformed colour falls back to the default, producing identical bytes.
    expect(bad.contentHash).toBe(dflt.contentHash);
  });
});

describe('PDF text extraction — the ATS premise', () => {
  it('reads a flush-right date in visual order, not content-stream order', async () => {
    const { bytes } = await generateResumePdf(resume, { template: 'modern' });
    const { text } = await extractText(bytes, 'pdf');
    // The title is drawn AFTER the right-aligned date, so a naive sequential
    // read yields "PresentSenior Backend Engineer". Reading order must follow
    // the page, left to right.
    expect(text).toMatch(/Senior Backend Engineer - Northwind Payments\s+Mar 2021 - Present/);
    expect(text).not.toMatch(/PresentSenior/);
  });

  it('round-trips the resume back into readable text', async () => {
    const { bytes } = await generateResumePdf(resume, { template: 'modern' });
    const extracted = await extractText(bytes, 'pdf');

    // If this fails, an ATS cannot read our own output either.
    expect(extracted.meta.likelyScanned).toBe(false);
    expect(extracted.text.length).toBeGreaterThan(400);

    for (const expected of [
      'Priya Sharma',
      'priya.sharma@example.com',
      'Northwind Payments',
      'Anna University',
      'PostgreSQL',
      'Kubernetes',
    ]) {
      expect(extracted.text, expected).toContain(expected);
    }
  });

  it('preserves quantified figures through the render/extract cycle', async () => {
    const { bytes } = await generateResumePdf(resume, { template: 'modern' });
    const { text } = await extractText(bytes, 'pdf');
    expect(text).toMatch(/2,400/);
    expect(text).toMatch(/840/);
    expect(text).toMatch(/210/);
  });

  it('keeps words separated — no glued text', async () => {
    const { bytes } = await generateResumePdf(resume, { template: 'modern' });
    const { text } = await extractText(bytes, 'pdf');
    // Glued words are the classic failure of PDFs built from positioned glyphs.
    // Anchored at a word boundary so intentional camel case (TypeScript,
    // JavaScript) is not reported as its own suffix.
    const glued = text.match(/\b[a-z]{3,}[A-Z][a-z]{3,}/g) ?? [];
    expect(glued).toEqual([]);
  });

  it('extracts cleanly from every template', async () => {
    for (const template of RESUME_TEMPLATES) {
      const { bytes } = await generateResumePdf(resume, { template });
      const { text, meta } = await extractText(bytes, 'pdf');
      expect(meta.likelyScanned, template).toBe(false);
      expect(text, template).toContain('Priya Sharma');
      expect(text, template).toContain('Northwind Payments');
    }
  });

  it('re-parses its own output back into structured sections', async () => {
    const { bytes } = await generateResumePdf(resume, { template: 'ats_safe' });
    const { text } = await extractText(bytes, 'pdf');
    const reparsed = normalizeResumeText(text).resume;

    // A full round trip: structured → PDF → text → structured.
    expect(reparsed.contact.fullName).toBe('Priya Sharma');
    expect(reparsed.contact.email).toBe('priya.sharma@example.com');
    expect(reparsed.experience.length).toBeGreaterThanOrEqual(2);
    expect(reparsed.education.length).toBeGreaterThanOrEqual(1);
  });

  it('does not destroy the caller’s buffer while parsing', async () => {
    // pdf.js takes ownership of the buffer it is given and detaches it. If the
    // extractor does not clone first, the caller is left holding a zero-length
    // array — which previously meant a stored resume could be empty.
    const { bytes } = await generateResumePdf(resume, { template: 'modern' });
    const lengthBefore = bytes.byteLength;
    expect(lengthBefore).toBeGreaterThan(1000);

    await extractText(bytes, 'pdf');

    expect(bytes.byteLength).toBe(lengthBefore);
    // Still readable a second time, from the same array.
    const second = await extractText(bytes, 'pdf');
    expect(second.text).toContain('Priya Sharma');
  });

  it('transliterates characters the standard fonts cannot encode', async () => {
    const exotic = structuredClone(resume);
    exotic.summary = 'Reduced latency — “significantly” — by ₹5,00,000 → better. Café ✓ emoji 🚀 dropped.';
    const { bytes } = await generateResumePdf(exotic, { template: 'modern' });
    const { text } = await extractText(bytes, 'pdf');

    expect(text).toContain('INR');
    expect(text).toContain('->');
    expect(text).toMatch(/"significantly"/);
    expect(text).not.toContain('🚀');
  });
});

describe('PDF storage optimization', () => {
  it('shrinks a PDF saved without object streams, and the result stays valid and text-identical', async () => {
    const { bytes } = await generateResumePdf(resume, { template: 'modern' });
    const doc = await PDFDocument.load(bytes);
    const unoptimized = await doc.save({ useObjectStreams: false });

    const result = await optimizePdfBytes(unoptimized);

    expect(result.optimized).toBe(true);
    expect(result.finalSize).toBeLessThan(result.originalSize);

    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getPageCount()).toBe(doc.getPageCount());

    const { text: beforeText } = await extractText(unoptimized, 'pdf');
    const { text: afterText } = await extractText(result.bytes, 'pdf');
    expect(afterText).toBe(beforeText);
  });

  it('falls back to the original bytes, unmodified, when the input cannot be parsed as a PDF', async () => {
    const garbage = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4, 5]);
    const result = await optimizePdfBytes(garbage);

    expect(result.optimized).toBe(false);
    expect(result.bytes).toBe(garbage);
    expect(result.finalSize).toBe(garbage.byteLength);
  });

  it('never returns a result larger than the input', async () => {
    // A PDF pdf-lib already saved with object streams has little left to gain;
    // the function must not silently swap in a bigger "optimized" copy.
    const { bytes } = await generateResumePdf(resume, { template: 'modern' });
    const result = await optimizePdfBytes(bytes);
    expect(result.finalSize).toBeLessThanOrEqual(result.originalSize);
  });
});
