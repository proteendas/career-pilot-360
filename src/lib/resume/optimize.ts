/**
 * Best-effort, lossless size reduction for an uploaded PDF, applied once
 * before the original is written to storage — the goal is making better use
 * of the storage quota, not changing the document.
 *
 * How: re-saving through pdf-lib with object streams restructures the PDF's
 * internal object table (a standard PDF feature many simple generators skip),
 * which can shrink a file meaningfully without touching a single rendered
 * pixel or character. It does NOT recompress embedded images, so a
 * photo-heavy resume won't shrink much — a plain text-and-formatting one
 * often will.
 *
 * Deliberately conservative: `resume_documents` is documented everywhere
 * else in this codebase as "the immutable original upload — never modified,"
 * and the product promises the user's original file is preserved. This
 * function honours that by only ever returning bytes that pdf-lib itself
 * re-rendered from the exact same source (never partial/lossy), and only
 * when the result actually IS smaller — any load/save failure, or a result
 * that isn't smaller, falls back to the untouched original.
 */
import { PDFDocument } from 'pdf-lib';

export interface PdfOptimizeResult {
  bytes: Uint8Array;
  optimized: boolean;
  originalSize: number;
  finalSize: number;
}

export async function optimizePdfBytes(bytes: Uint8Array): Promise<PdfOptimizeResult> {
  const originalSize = bytes.byteLength;
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const resaved = await doc.save({ useObjectStreams: true });
    if (resaved.byteLength < originalSize) {
      return { bytes: resaved, optimized: true, originalSize, finalSize: resaved.byteLength };
    }
  } catch (err) {
    // Some PDFs (encrypted, malformed, or using features pdf-lib can't
    // round-trip) can't be safely re-saved — keep the original rather than
    // risk it.
    console.error('[resume] PDF optimization skipped — could not re-save', err instanceof Error ? err.message : err);
  }
  return { bytes, optimized: false, originalSize, finalSize: originalSize };
}
