/**
 * The parser encodes a hyperlink it recovered from an uploaded document
 * (see `parse.ts`) as `[label](url)` inline in the extracted plain text — the
 * same convention Markdown uses. Both renderers (`pdf.ts` and `docx.ts`) need
 * to recognise and unwrap it before drawing the text.
 */
const MARKDOWN_LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;

export function splitMarkdownLink(value: string): { label: string; url: string } | null {
  const trimmed = (value ?? '').trim();
  const m = MARKDOWN_LINK_RE.exec(trimmed);
  if (!m) return null;
  return { label: m[1]!.trim(), url: m[2]!.trim() };
}
