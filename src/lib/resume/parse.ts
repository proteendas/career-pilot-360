/**
 * Document text extraction. Server-only.
 *
 * Both parsers are pure JavaScript and treat the file as data: nothing is
 * executed, nothing is shelled out to, and DOCX macros are never evaluated.
 * Bytes reach here only after `validateUpload` has confirmed the format from
 * its magic bytes.
 */
import { sanitizeImportedText } from '@/lib/security';
import type { UploadKind } from '@/lib/security';

export interface ExtractionResult {
  text: string;
  /** Diagnostics surfaced to the user, e.g. "this looks like a scanned PDF". */
  warnings: string[];
  meta: {
    kind: UploadKind;
    pageCount: number | null;
    charCount: number;
    /** True when the document yielded so little text it is probably an image. */
    likelyScanned: boolean;
    parser: string;
  };
}

export class ParseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ParseError';
    this.code = code;
  }
}

/** Below this, a multi-page document is almost certainly a scan. */
const MIN_CHARS_PER_PAGE = 80;

export async function extractText(bytes: Uint8Array, kind: UploadKind): Promise<ExtractionResult> {
  return kind === 'pdf' ? extractFromPdf(bytes) : extractFromDocx(bytes);
}

/**
 * Assemble page text from positioned text items.
 *
 * We do this ourselves rather than taking the library's pre-joined string
 * because the naive join concatenates runs that merely share a baseline. On a
 * resume that puts dates flush right, "Mar 2021 - Present" and "Senior
 * Engineer" sit on one line and come back as "PresentSenior" — exactly the
 * kind of token an applicant tracking system then fails to match. Reconstructing
 * from geometry inserts the separator that the visual layout implies.
 */
interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  hasEOL: boolean;
}

function assembleLines(items: TextItem[]): string {
  // 1. Bucket items by baseline. Content-stream order is NOT reading order:
  //    a flush-right date is emitted before the title it sits beside, so
  //    walking the stream sequentially produces "PresentSenior Engineer".
  const buckets: { y: number; items: TextItem[] }[] = [];

  for (const item of items) {
    if (!item.str.trim()) continue;
    // Items within ~2.5pt vertically are on the same visual line.
    const bucket = buckets.find((b) => Math.abs(b.y - item.y) <= 2.5);
    if (bucket) {
      bucket.items.push(item);
      // Track the mean baseline so drift does not split a line in two.
      bucket.y = (bucket.y * (bucket.items.length - 1) + item.y) / bucket.items.length;
    } else {
      buckets.push({ y: item.y, items: [item] });
    }
  }

  // 2. Top to bottom. PDF space puts the origin at the bottom-left, so a
  //    larger y is higher on the page.
  buckets.sort((a, b) => b.y - a.y);

  // 3. Left to right within each line, inserting a separator wherever the
  //    layout leaves a visible gap.
  const lines = buckets.map((bucket) => {
    const ordered = [...bucket.items].sort((a, b) => a.x - b.x);
    let line = '';
    let lastEndX: number | null = null;

    for (const item of ordered) {
      if (line && lastEndX !== null) {
        const gap = item.x - lastEndX;
        const needsSpace = gap > 1 && !/\s$/.test(line) && !/^\s/.test(item.str);
        if (needsSpace) line += gap > 12 ? '  ' : ' ';
      }
      line += item.str;
      lastEndX = item.x + item.width;
    }

    return line.replace(/[ \t]+/g, ' ').trim();
  });

  return lines.filter(Boolean).join('\n');
}

async function extractFromPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  let raw = '';
  let pageCount: number | null = null;

  try {
    const { extractTextItems, getDocumentProxy } = await import('unpdf');

    // pdf.js takes OWNERSHIP of the buffer it is handed and detaches it, which
    // leaves the caller holding a zero-length array. `uploadResume` passes the
    // same array to storage, so without this copy a stored resume could end up
    // empty depending on whether the driver copies. Parse a throwaway clone.
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    pageCount = doc.numPages;

    // Page boundaries are preserved: we need them to detect scans and to warn
    // about multi-column layouts.
    const { items } = await extractTextItems(doc);
    raw = items.map((pageItems) => assembleLines(pageItems)).join('\n\n');
  } catch (err) {
    throw new ParseError(
      'pdf_parse_failed',
      `Could not read that PDF (${err instanceof Error ? err.message : 'unknown error'}). ` +
        'If it is password-protected, remove the protection and upload it again.',
    );
  }

  const text = normalizeWhitespace(sanitizeImportedText(raw));
  const warnings: string[] = [];
  const perPage = pageCount && pageCount > 0 ? text.length / pageCount : text.length;
  const likelyScanned = text.trim().length < 200 || perPage < MIN_CHARS_PER_PAGE;

  if (likelyScanned) {
    warnings.push(
      'Very little text could be extracted. This PDF is probably a scan or an image export. ' +
        'Applicant tracking systems cannot read it either — export a text-based PDF from your editor instead.',
    );
  }
  if (pageCount && pageCount > 3) {
    warnings.push(`This resume is ${pageCount} pages. Most reviewers expect one or two.`);
  }
  if (looksMultiColumn(text)) {
    warnings.push(
      'The text order suggests a multi-column layout. Columns often interleave when parsed, ' +
        'so a single-column layout is safer for ATS extraction.',
    );
  }

  return {
    text,
    warnings,
    meta: { kind: 'pdf', pageCount, charCount: text.length, likelyScanned, parser: 'unpdf' },
  };
}

async function extractFromDocx(bytes: Uint8Array): Promise<ExtractionResult> {
  let raw = '';
  const warnings: string[] = [];

  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    raw = result.value ?? '';
    for (const msg of result.messages ?? []) {
      // Mammoth reports unsupported constructs; the useful ones mention tables
      // and text boxes, both of which parse badly in ATS pipelines.
      if (/table|textbox|text box|drawing|image/i.test(msg.message)) {
        warnings.push(
          'This document uses tables, text boxes or images for layout. ' +
            'Those frequently scramble or disappear when an ATS extracts text.',
        );
        break;
      }
    }
  } catch (err) {
    throw new ParseError(
      'docx_parse_failed',
      `Could not read that DOCX (${err instanceof Error ? err.message : 'unknown error'}).`,
    );
  }

  const text = normalizeWhitespace(sanitizeImportedText(raw));
  const likelyScanned = text.trim().length < 200;
  if (likelyScanned) {
    warnings.push('Very little text could be extracted from this document.');
  }

  return {
    text,
    warnings: [...new Set(warnings)],
    meta: { kind: 'docx', pageCount: null, charCount: text.length, likelyScanned, parser: 'mammoth' },
  };
}

/**
 * Tidy extracted text without destroying structure.
 * PDF extraction tends to produce ragged spacing and split bullets; both
 * confuse section detection downstream.
 */
export function normalizeWhitespace(input: string): string {
  return (input ?? '')
    .replace(/\r\n?/g, '\n')
    // Non-breaking and exotic spaces become ordinary spaces.
    .replace(/[  -   　]/g, ' ')
    // Normalise the many bullet glyphs to one.
    .replace(/^[\s]*[•‣▪●◦⁃∙·․*–—-]\s+/gm, '• ')
    // Ligatures that PDF fonts emit as single glyphs.
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬃ/g, 'ffi')
    .replace(/ﬄ/g, 'ffl')
    // Collapse runs of spaces but keep newlines.
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Heuristic: multi-column PDFs produce many short lines that are not bullets,
 * because each column fragment lands on its own line.
 */
function looksMultiColumn(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 25) return false;
  const shortNonBullet = lines.filter((l) => {
    const t = l.trim();
    return t.length > 0 && t.length < 18 && !t.startsWith('•') && !/^[A-Z\s]{3,}$/.test(t);
  });
  return shortNonBullet.length / lines.length > 0.45;
}
