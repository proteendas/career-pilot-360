/**
 * The parser encodes a hyperlink it recovered from an uploaded document
 * (see `parse.ts`) as `[label](url)` inline in the extracted plain text — the
 * same convention Markdown uses. Both renderers (`pdf.ts` and `docx.ts`) need
 * to recognise and unwrap it before drawing the text.
 */
const MARKDOWN_LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;
const INLINE_MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function splitMarkdownLink(value: string): { label: string; url: string } | null {
  const trimmed = (value ?? '').trim();
  const m = MARKDOWN_LINK_RE.exec(trimmed);
  if (!m) return null;
  return { label: m[1]!.trim(), url: m[2]!.trim() };
}

export interface InlineSegment {
  text: string;
  url?: string;
}

/**
 * Split free-form text (a bullet, a summary, a description) into plain and
 * linked segments, wherever a `[label](url)` appears — unlike
 * `splitMarkdownLink`, the link need not be the whole string. Returns a
 * single plain segment when there is nothing to link.
 */
export function parseInlineLinks(value: string): InlineSegment[] {
  const text = value ?? '';
  const segments: InlineSegment[] = [];
  let lastIndex = 0;

  for (const m of text.matchAll(INLINE_MARKDOWN_LINK_RE)) {
    const idx = m.index ?? 0;
    if (idx > lastIndex) segments.push({ text: text.slice(lastIndex, idx) });
    segments.push({ text: m[1]!.trim(), url: m[2]!.trim() });
    lastIndex = idx + m[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });

  return segments.length ? segments : [{ text }];
}
