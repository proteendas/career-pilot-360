/**
 * Server-side resume PDF generation with pdf-lib.
 *
 * Why pdf-lib rather than an HTML-to-PDF renderer: it draws real text with
 * embedded standard fonts, so the output has a clean text layer that extracts
 * in the correct reading order. A headless-browser screenshot pipeline would
 * also need Chromium in the function, which is both heavy and, for ATS
 * purposes, worse — layout-driven PDFs are exactly what parsers mis-read.
 *
 * ATS rules honoured by every template here:
 *  - single column, top to bottom, left to right;
 *  - no text inside images, no text as vector outlines;
 *  - no tables, no text boxes, no multi-column flow;
 *  - real spaces between words (each line drawn as one string);
 *  - headings as plain bold text, not graphics;
 *  - page breaks between blocks, never mid-line.
 *
 * Real URLs (contact links, project/certification links, the Links section)
 * are drawn as genuine clickable link annotations, not just visible text —
 * see `Renderer.addLink` and `Renderer.inlineRow`.
 */
import {
  PDFDocument,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { contentHash } from '@/lib/security';
import type { StructuredResume } from './types';
import { PAGE_SIZES, THEMES, type ResumeTemplate, type Theme } from './theme';
import { parseInlineLinks, splitMarkdownLink } from './markdown-link';

export {
  RESUME_TEMPLATES,
  TEMPLATE_META,
  isResumeTemplate,
  type ResumeTemplate,
} from './theme';

export interface PdfOptions {
  template?: ResumeTemplate;
  /** Points. 54pt ≈ 19mm. */
  margin?: number;
  fontSize?: number;
  lineSpacing?: number;
  /** Hex accent, e.g. "#c96442". Ignored by minimal, ats_safe and classic. */
  accentColor?: string;
  /** 'single' compresses spacing to try to fit one page. */
  pageMode?: 'single' | 'multi';
  includeSummary?: boolean;
  includeProjects?: boolean;
  includeCertifications?: boolean;
  includeAwards?: boolean;
  includePublications?: boolean;
  includeVolunteer?: boolean;
  includeLanguages?: boolean;
  includeLinks?: boolean;
  includeAdditional?: boolean;
}

export interface PdfResult {
  bytes: Uint8Array;
  pageCount: number;
  contentHash: string;
  template: ResumeTemplate;
  /** Set when content had to be trimmed to honour `pageMode: 'single'`. */
  truncated: boolean;
}

function parseHex(hex: string | undefined, fallback: RGB): RGB {
  const value = (hex ?? '').trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return fallback;
  return rgb(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  );
}

/**
 * pdf-lib's standard fonts are WinAnsi-encoded and throw on characters outside
 * that range. Resume text routinely contains typographic dashes, curly quotes
 * and the odd emoji, so everything is transliterated to safe equivalents first.
 */
function toWinAnsi(value: string): string {
  return (value ?? '')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—‒―]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•‣◦⁃∙]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[‐‑]/g, '-')
    .replace(/₹/g, 'INR ')
    .replace(/→/g, '->')
    .replace(/×/g, 'x')
    // Anything still outside the printable Latin-1 range is dropped rather than
    // allowed to throw mid-render.
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

/** A word tagged with the URL it links to, when it came from a `[label](url)` span. */
interface Word {
  text: string;
  url?: string;
}

/** Split free text into words, resolving any inline `[label](url)` links first. */
function tokenizeWords(value: string): Word[] {
  const words: Word[] = [];
  for (const seg of parseInlineLinks(value)) {
    const safe = toWinAnsi(seg.text).replace(/\s+/g, ' ').trim();
    if (!safe) continue;
    for (const w of safe.split(' ')) {
      if (w) words.push({ text: w, url: seg.url });
    }
  }
  return words;
}

/**
 * Greedy word wrap against real font metrics — over tagged words rather than
 * a plain string, so a hyperlinked word survives wrapping and still knows
 * which URL it belongs to.
 */
function wrapWords(words: Word[], font: PDFFont, size: number, maxWidth: number, spaceWidth: number): Word[][] {
  const lines: Word[][] = [];
  let current: Word[] = [];
  let currentWidth = 0;

  const flush = () => {
    if (current.length) lines.push(current);
    current = [];
    currentWidth = 0;
  };

  for (const word of words) {
    const wordWidth = font.widthOfTextAtSize(word.text, size);

    if (wordWidth > maxWidth) {
      // A single word longer than the line: break it by character.
      flush();
      let chunk = '';
      for (const char of word.text) {
        const candidate = chunk + char;
        if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push([{ text: chunk, url: word.url }]);
          chunk = char;
        } else {
          chunk = candidate;
        }
      }
      if (chunk) {
        current = [{ text: chunk, url: word.url }];
        currentWidth = font.widthOfTextAtSize(chunk, size);
      }
      continue;
    }

    const withSpace = current.length ? spaceWidth + wordWidth : wordWidth;
    if (current.length && currentWidth + withSpace > maxWidth) {
      flush();
      current = [word];
      currentWidth = wordWidth;
    } else {
      current.push(word);
      currentWidth += withSpace;
    }
  }
  flush();
  return lines;
}

interface Segment {
  text: string;
  url?: string;
  font?: PDFFont;
  color?: RGB;
}

/** Renderer holding cursor state and handling page breaks. */
class Renderer {
  private page: PDFPage;
  private y: number;
  readonly pages: PDFPage[] = [];
  private readonly pageWidth: number;
  private readonly pageHeight: number;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: {
      sans: PDFFont; sansBold: PDFFont; sansItalic: PDFFont;
      serif: PDFFont; serifBold: PDFFont; mono: PDFFont;
    },
    private readonly margin: number,
    private readonly baseSize: number,
    private readonly lineSpacing: number,
    private readonly theme: Theme,
    private readonly accent: RGB,
    private readonly ink: RGB,
    private readonly muted: RGB,
  ) {
    const size = PAGE_SIZES[theme.pageSize];
    this.pageWidth = size.width;
    this.pageHeight = size.height;
    this.page = doc.addPage([this.pageWidth, this.pageHeight]);
    this.pages.push(this.page);
    this.y = this.pageHeight - margin;
  }

  get contentWidth(): number {
    return this.pageWidth - this.margin * 2;
  }

  get remaining(): number {
    return this.y - this.margin;
  }

  private lineHeight(size: number): number {
    return size * this.lineSpacing;
  }

  /** Start a new page. Called only between blocks, never mid-line. */
  newPage(): void {
    this.page = this.doc.addPage([this.pageWidth, this.pageHeight]);
    this.pages.push(this.page);
    this.y = this.pageHeight - this.margin;
  }

  ensure(space: number): void {
    if (this.remaining < space) this.newPage();
  }

  gap(points: number): void {
    this.y -= points;
  }

  /**
   * Register a real clickable link over a rectangular region of the current
   * page. This is metadata only — it draws nothing — so it never affects the
   * plain-text ATS extraction of the page.
   */
  addLink(x: number, y: number, width: number, height: number, url: string): void {
    const safeUrl = (url ?? '').trim();
    if (!safeUrl) return;
    const annotDict = this.doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [x, y, x + width, y + height],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(safeUrl) },
    });
    const ref = this.doc.context.register(annotDict);
    this.page.node.addAnnot(ref);
  }

  /**
   * Draw wrapped text. Any inline `[label](url)` span the parser recovered
   * from the original document — e.g. a word that was a hyperlink in the
   * upload — is drawn as a real clickable link, underlined, in place.
   */
  text(
    value: string,
    opts: {
      font?: PDFFont;
      size?: number;
      color?: RGB;
      indent?: number;
      maxWidth?: number;
      letterSpacing?: number;
    } = {},
  ): void {
    const font = opts.font ?? this.fonts[this.theme.bodyFont === 'serif' ? 'serif' : 'sans'];
    const size = opts.size ?? this.baseSize;
    const color = opts.color ?? this.ink;
    const indent = opts.indent ?? 0;
    const width = (opts.maxWidth ?? this.contentWidth) - indent;
    const spaceWidth = font.widthOfTextAtSize(' ', size);

    for (const line of wrapWords(tokenizeWords(value), font, size, width, spaceWidth)) {
      this.ensure(this.lineHeight(size));
      const y = this.y - size;
      let x = this.margin + indent;
      line.forEach((word, i) => {
        if (i > 0) x += spaceWidth;
        const w = font.widthOfTextAtSize(word.text, size);
        this.page.drawText(word.text, {
          x,
          y,
          size,
          font,
          color,
          ...(opts.letterSpacing ? { characterSpacing: opts.letterSpacing } : {}),
        });
        if (word.url) {
          this.page.drawLine({ start: { x, y: y - 1 }, end: { x: x + w, y: y - 1 }, thickness: 0.5, color });
          this.addLink(x, y - 2, w, size + 3, word.url);
        }
        x += w;
      });
      this.y -= this.lineHeight(size);
    }
  }

  /**
   * One or more short segments on a single line — "A | B | C" — optionally
   * centered, with any segment carrying a URL drawn as a real hyperlink
   * (underlined so it reads as clickable) instead of plain text. Used for the
   * contact/links header row and any field that is itself a URL.
   */
  inlineRow(
    segments: Segment[],
    opts: { size?: number; separator?: string; align?: 'left' | 'center'; color?: RGB } = {},
  ): void {
    const parts = segments.filter((s) => s.text?.trim());
    if (parts.length === 0) return;

    const size = opts.size ?? this.baseSize;
    const separator = opts.separator ?? '   |   ';
    const color = opts.color ?? this.muted;
    const defaultFont = this.fonts[this.theme.bodyFont === 'serif' ? 'serif' : 'sans'];
    const sepWidth = defaultFont.widthOfTextAtSize(separator, size);

    const widths = parts.map((p) => (p.font ?? defaultFont).widthOfTextAtSize(toWinAnsi(p.text), size));
    const totalWidth = widths.reduce((a, b) => a + b, 0) + sepWidth * (parts.length - 1);

    this.ensure(this.lineHeight(size));
    const y = this.y - size;
    let x =
      opts.align === 'center'
        ? this.margin + Math.max(0, (this.contentWidth - totalWidth) / 2)
        : this.margin;

    parts.forEach((p, i) => {
      const font = p.font ?? defaultFont;
      const safe = toWinAnsi(p.text);
      const w = widths[i]!;
      const segColor = p.color ?? color;
      this.page.drawText(safe, { x, y, size, font, color: segColor });
      if (p.url) {
        this.page.drawLine({
          start: { x, y: y - 1 },
          end: { x: x + w, y: y - 1 },
          thickness: 0.5,
          color: segColor,
        });
        this.addLink(x, y - 2, w, size + 3, p.url);
      }
      x += w;
      if (i < parts.length - 1) {
        this.page.drawText(separator, { x, y, size, font: defaultFont, color });
        x += sepWidth;
      }
    });

    this.y -= this.lineHeight(size);
  }

  /**
   * A bullet line with a hanging indent, so wrapped lines align. Any inline
   * `[label](url)` span is drawn as a real clickable link, same as `text()`.
   */
  bullet(value: string, opts: { size?: number; indent?: number } = {}): void {
    const font = this.fonts[this.theme.bodyFont === 'serif' ? 'serif' : 'sans'];
    const size = opts.size ?? this.baseSize;
    const indent = opts.indent ?? 0;
    const markerWidth = font.widthOfTextAtSize('- ', size);
    const width = this.contentWidth - indent - markerWidth;
    const spaceWidth = font.widthOfTextAtSize(' ', size);
    const lines = wrapWords(tokenizeWords(value), font, size, width, spaceWidth);
    if (lines.length === 0) return;

    // Keep at least the first two lines of a bullet together.
    this.ensure(this.lineHeight(size) * Math.min(2, lines.length));

    lines.forEach((words, i) => {
      this.ensure(this.lineHeight(size));
      const y = this.y - size;
      if (i === 0) {
        this.page.drawText('-', { x: this.margin + indent, y, size, font, color: this.muted });
      }
      let x = this.margin + indent + markerWidth;
      words.forEach((word, wi) => {
        if (wi > 0) x += spaceWidth;
        const w = font.widthOfTextAtSize(word.text, size);
        this.page.drawText(word.text, { x, y, size, font, color: this.ink });
        if (word.url) {
          this.page.drawLine({ start: { x, y: y - 1 }, end: { x: x + w, y: y - 1 }, thickness: 0.5, color: this.ink });
          this.addLink(x, y - 2, w, size + 3, word.url);
        }
        x += w;
      });
      this.y -= this.lineHeight(size);
    });
  }

  /** Section heading, optionally with a rule beneath it. */
  heading(label: string): void {
    const font = this.fonts[this.theme.headingFont === 'serif-bold' ? 'serifBold' : 'sansBold'];
    const size = this.theme.headingSize;
    const text = this.theme.uppercaseHeadings ? label.toUpperCase() : label;

    // A heading immediately before a page break is useless: keep it with
    // at least two lines of its content.
    this.ensure(this.lineHeight(size) + this.lineHeight(this.baseSize) * 2 + 10);
    this.gap(this.theme.ruleUnderHeading ? 8 : 6);

    this.page.drawText(toWinAnsi(text), {
      x: this.margin,
      y: this.y - size,
      size,
      font,
      color: this.theme.useAccent ? this.accent : this.ink,
      ...(this.theme.headingLetterSpacing ? { characterSpacing: this.theme.headingLetterSpacing } : {}),
    });
    this.y -= this.lineHeight(size);

    if (this.theme.ruleUnderHeading) {
      this.y -= 2;
      this.page.drawLine({
        start: { x: this.margin, y: this.y },
        end: { x: this.pageWidth - this.margin, y: this.y },
        thickness: 0.75,
        color: this.theme.useAccent ? this.accent : this.muted,
      });
      this.y -= 6;
    } else {
      this.y -= 2;
    }
  }

  /** Right-aligned text on the current line, for dates beside a job title. */
  rightText(value: string, opts: { size?: number; font?: PDFFont; color?: RGB; yOffset?: number } = {}): void {
    const font = opts.font ?? this.fonts.sansItalic;
    const size = opts.size ?? this.baseSize - 0.5;
    const safe = toWinAnsi(value);
    if (!safe) return;
    const width = font.widthOfTextAtSize(safe, size);
    this.page.drawText(safe, {
      x: this.pageWidth - this.margin - width,
      y: this.y - size + (opts.yOffset ?? 0),
      size,
      font,
      color: opts.color ?? this.muted,
    });
  }

  /** Width available to the left of a right-aligned string. */
  widthMinus(value: string, font: PDFFont, size: number): number {
    return this.contentWidth - font.widthOfTextAtSize(toWinAnsi(value), size) - 12;
  }

  get monoFont(): PDFFont {
    return this.fonts.mono;
  }
  get sansFont(): PDFFont {
    return this.fonts.sans;
  }
  get boldFont(): PDFFont {
    return this.fonts[this.theme.headingFont === 'serif-bold' ? 'serifBold' : 'sansBold'];
  }
  get italicFont(): PDFFont {
    return this.fonts.sansItalic;
  }
  get inkColor(): RGB {
    return this.ink;
  }
  get mutedColor(): RGB {
    return this.muted;
  }
}

function formatRange(start: string, end: string, current: boolean): string {
  const to = current ? 'Present' : end;
  if (start && to) return `${start} - ${to}`;
  return start || to || '';
}

/**
 * A "title - detail" line that may itself carry a link (e.g. a certificate's
 * verification URL, or a bare markdown link the parser recovered from an
 * uploaded document's hyperlink).
 */
function titleDetailSegments(title: string, detail: string, url: string): Segment[] {
  const titleLink = splitMarkdownLink(title);
  const segments: Segment[] = [];
  if (titleLink) segments.push({ text: titleLink.label, url: titleLink.url });
  else if (title) segments.push({ text: title });
  if (detail) segments.push({ text: detail });
  if (url && !titleLink) segments.push({ text: 'Verify', url });
  return segments;
}

/** Generate the PDF. Pure apart from the pdf-lib document it builds. */
export async function generateResumePdf(
  resume: StructuredResume,
  options: PdfOptions = {},
): Promise<PdfResult> {
  const template = options.template ?? 'classic';
  const theme = THEMES[template];
  const single = options.pageMode === 'single';

  const margin = Math.max(28, Math.min(80, options.margin ?? theme.defaultMargin));
  const baseSize = Math.max(
    8,
    Math.min(12, options.fontSize ?? (single ? theme.defaultFontSize - 0.5 : theme.defaultFontSize)),
  );
  const lineSpacing = Math.max(
    1.05,
    Math.min(1.8, options.lineSpacing ?? (single ? theme.defaultLineSpacing - 0.12 : theme.defaultLineSpacing)),
  );

  const doc = await PDFDocument.create();
  doc.setTitle(`${resume.contact.fullName || 'Resume'} - Resume`);
  doc.setProducer('CareerPilot360');
  doc.setCreator('CareerPilot360');
  // A fixed creation date keeps the output byte-stable, so the content hash
  // identifies the CONTENT rather than the moment it was rendered.
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));

  const fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    sansItalic: await doc.embedFont(StandardFonts.HelveticaOblique),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };

  const accent = parseHex(options.accentColor, rgb(0.788, 0.392, 0.259));
  const ink = rgb(0.12, 0.12, 0.11);
  const muted = rgb(0.42, 0.41, 0.39);

  const r = new Renderer(doc, fonts, margin, baseSize, lineSpacing, theme, accent, ink, muted);
  let truncated = false;
  const align = theme.centerHeader ? 'center' : 'left';

  /* ------------------------------------------------------------- header -- */
  const c = resume.contact;
  if (c.fullName) {
    r.inlineRow([{ text: c.fullName, font: r.boldFont, color: ink }], { size: theme.nameSize, align });
  }
  if (c.headline) {
    r.inlineRow([{ text: c.headline, color: muted }], { size: baseSize + 0.5, align });
  }

  r.gap(2);
  r.inlineRow(
    [{ text: c.email }, { text: c.phone }, { text: c.location }],
    { size: baseSize - 0.5, align },
  );
  const linkSegments: Segment[] = [];
  if (c.linkedinUrl) linkSegments.push({ text: 'LinkedIn', url: c.linkedinUrl });
  if (c.githubUrl) linkSegments.push({ text: 'GitHub', url: c.githubUrl });
  if (c.portfolioUrl) linkSegments.push({ text: 'Portfolio', url: c.portfolioUrl });
  if (c.websiteUrl) linkSegments.push({ text: 'Website', url: c.websiteUrl });
  r.inlineRow(linkSegments, { size: baseSize - 0.5, align });

  /* ------------------------------------------------------------ summary -- */
  if (options.includeSummary !== false && resume.summary) {
    r.heading('Professional Summary');
    r.text(resume.summary, { size: baseSize });
  }

  /* --------------------------------------------------------- experience -- */
  if (resume.experience.length > 0) {
    r.heading('Experience');
    for (const [index, exp] of resume.experience.entries()) {
      if (index > 0) r.gap(5);
      const dates = formatRange(exp.startDate, exp.endDate, exp.current);

      // Title and company on one line, dates right-aligned on the same line.
      const titleLine = [exp.title, exp.company].filter(Boolean).join(' - ');
      if (titleLine) {
        const titleSize = baseSize + 0.5;
        r.ensure(r.contentWidth > 0 ? titleSize * lineSpacing * 2 : 0);
        if (dates) r.rightText(dates, { size: baseSize - 0.5, font: r.italicFont });
        r.text(titleLine, {
          font: r.boldFont,
          size: titleSize,
          maxWidth: dates ? r.widthMinus(dates, r.italicFont, baseSize - 0.5) : undefined,
        });
      } else if (dates) {
        r.text(dates, { size: baseSize - 0.5, color: muted, font: r.italicFont });
      }

      if (exp.location) r.text(exp.location, { size: baseSize - 0.5, color: muted });
      if (exp.summary) r.text(exp.summary, { size: baseSize });

      for (const bullet of exp.bullets) {
        if (bullet.text) r.bullet(bullet.text, { size: baseSize });
      }

      if (exp.technologies.length > 0) {
        const label = `Technologies: ${exp.technologies.join(', ')}`;
        r.text(label, {
          size: baseSize - 1,
          color: muted,
          ...(theme.monoForTech ? { font: r.monoFont } : {}),
        });
      }
    }
  }

  /* ----------------------------------------------------------- projects -- */
  if (options.includeProjects !== false && resume.projects.length > 0) {
    r.heading('Projects');
    for (const [index, project] of resume.projects.entries()) {
      if (index > 0) r.gap(4);
      const dates = formatRange(project.startDate, project.endDate, false);
      const nameLine = [project.name, project.role].filter(Boolean).join(' - ');
      if (nameLine) {
        if (dates) r.rightText(dates, { size: baseSize - 0.5, font: r.italicFont });
        r.text(nameLine, {
          font: r.boldFont,
          size: baseSize + 0.5,
          maxWidth: dates ? r.widthMinus(dates, r.italicFont, baseSize - 0.5) : undefined,
        });
      }
      if (project.url) {
        r.inlineRow([{ text: project.url, url: project.url }], { size: baseSize - 1, color: muted });
      }
      if (project.description) r.text(project.description, { size: baseSize });
      for (const bullet of project.bullets) {
        if (bullet.text) r.bullet(bullet.text, { size: baseSize });
      }
      if (project.technologies.length > 0) {
        r.text(`Technologies: ${project.technologies.join(', ')}`, {
          size: baseSize - 1,
          color: muted,
          ...(theme.monoForTech ? { font: r.monoFont } : {}),
        });
      }
    }
  }

  /* ------------------------------------------------------------- skills -- */
  if (resume.skills.length > 0) {
    r.heading('Skills');
    for (const group of resume.skills) {
      if (group.skills.length === 0) continue;
      const line = group.category ? `${group.category}: ${group.skills.join(', ')}` : group.skills.join(', ');
      r.text(line, { size: baseSize });
    }
  }

  /* ---------------------------------------------------------- education -- */
  if (resume.education.length > 0) {
    r.heading('Education');
    for (const [index, edu] of resume.education.entries()) {
      if (index > 0) r.gap(3);
      const dates = formatRange(edu.startDate, edu.endDate, false);
      const degreeLine = [edu.degree, edu.field].filter(Boolean).join(', ');
      if (degreeLine) {
        if (dates) r.rightText(dates, { size: baseSize - 0.5, font: r.italicFont });
        r.text(degreeLine, {
          font: r.boldFont,
          size: baseSize,
          maxWidth: dates ? r.widthMinus(dates, r.italicFont, baseSize - 0.5) : undefined,
        });
      }
      const instLine = [edu.institution, edu.location, edu.grade].filter(Boolean).join('  |  ');
      if (instLine) r.text(instLine, { size: baseSize - 0.5, color: muted });
      for (const detail of edu.details) r.bullet(detail, { size: baseSize - 0.5 });
    }
  }

  /* ----------------------------------------------------- certifications -- */
  if (options.includeCertifications !== false && resume.certifications.length > 0) {
    r.heading('Certifications');
    for (const cert of resume.certifications) {
      if (!cert.name) continue;
      if (cert.date) r.rightText(cert.date, { size: baseSize - 0.5, font: r.italicFont });
      const nameLink = splitMarkdownLink(cert.name);
      const nameSegments: Segment[] = nameLink
        ? [{ text: nameLink.label, url: nameLink.url, font: r.boldFont, color: ink }]
        : [{ text: cert.name, font: r.boldFont, color: ink }];
      if (cert.issuer) nameSegments.push({ text: `- ${cert.issuer}`, font: r.sansFont, color: ink });
      r.inlineRow(nameSegments, { size: baseSize, separator: ' ' });

      const detailBits: Segment[] = [];
      if (cert.credentialId) detailBits.push({ text: `Credential ID: ${cert.credentialId}` });
      if (cert.url && !nameLink) detailBits.push({ text: 'Verify credential', url: cert.url });
      if (detailBits.length) r.inlineRow(detailBits, { size: baseSize - 1, separator: '   |   ' });
    }
  }

  /* ----------------------------------------------------- simple sections -- */
  const simpleSections: [boolean, string, { title: string; detail: string; date: string; url?: string }[]][] = [
    [
      options.includeAwards !== false,
      'Awards',
      resume.awards.map((x) => ({ title: x.title, detail: x.detail, date: x.date })),
    ],
    [
      options.includePublications !== false,
      'Publications',
      resume.publications.map((x) => ({ title: x.title, detail: x.detail, date: x.date })),
    ],
    [
      options.includeVolunteer !== false,
      'Volunteer Experience',
      resume.volunteer.map((x) => ({ title: x.title, detail: x.detail, date: x.date })),
    ],
  ];

  for (const [include, heading, entries] of simpleSections) {
    const rows = entries.filter((e) => e.title);
    if (!include || rows.length === 0) continue;
    r.heading(heading);
    for (const row of rows) {
      if (row.date) r.rightText(row.date, { size: baseSize - 0.5, font: r.italicFont });
      const segments = titleDetailSegments(row.title, row.detail, row.url ?? '');
      r.inlineRow(segments, { size: baseSize, separator: ' - ' });
    }
  }

  if (options.includeLanguages !== false && resume.languages.length > 0) {
    r.heading('Languages');
    r.text(resume.languages.join(', '), { size: baseSize });
  }

  if (options.includeLinks !== false && resume.links.length > 0) {
    r.heading('Links');
    for (const link of resume.links) {
      r.inlineRow(
        [{ text: link.label || link.url, url: link.url }],
        { size: baseSize - 0.5, separator: ': ' },
      );
    }
  }

  if (options.includeAdditional !== false && resume.additional) {
    r.heading('Additional Information');
    r.text(resume.additional, { size: baseSize });
  }

  // Unclassified content is still the user's, so it is never dropped silently.
  for (const section of resume.unparsedSections) {
    if (!section.body) continue;
    r.heading(section.heading || 'Additional');
    r.text(section.body, { size: baseSize });
  }

  const bytes = await doc.save({ useObjectStreams: false });
  const pageCount = doc.getPageCount();

  if (single && pageCount > 1) {
    // Report rather than silently discard: the caller shows the user that
    // single-page mode could not be honoured at these settings.
    truncated = true;
  }

  return {
    bytes: new Uint8Array(bytes),
    pageCount,
    contentHash: await contentHash(bytes),
    template,
    truncated,
  };
}
