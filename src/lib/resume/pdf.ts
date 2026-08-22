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
 */
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { contentHash } from '@/lib/security';
import type { StructuredResume } from './types';

export const RESUME_TEMPLATES = ['modern', 'minimal', 'technical', 'executive', 'ats_safe'] as const;
export type ResumeTemplate = (typeof RESUME_TEMPLATES)[number];

export const TEMPLATE_META: Record<
  ResumeTemplate,
  { label: string; description: string; atsNote: string }
> = {
  modern: {
    label: 'Modern',
    description: 'Sans-serif with a coloured accent rule under each section heading.',
    atsNote: 'Single column, text-only. The accent is a drawn line, never an image.',
  },
  minimal: {
    label: 'Minimal',
    description: 'Generous whitespace, no rules, no colour. Quiet and highly legible.',
    atsNote: 'The most conservative layout. Nothing but text and spacing.',
  },
  technical: {
    label: 'Technical',
    description: 'Compact, with a monospace treatment for technologies. Fits more per page.',
    atsNote: 'Monospace is used only for technology lists, which parse as ordinary text.',
  },
  executive: {
    label: 'Executive',
    description: 'Serif headings, wider margins, a formal register.',
    atsNote: 'Serif faces extract identically to sans. Single column throughout.',
  },
  ats_safe: {
    label: 'ATS-safe',
    description: 'Deliberately plain: one font, one size, capitalised headings, no colour.',
    atsNote: 'The safest possible output. Use this when a posting warns about parsing.',
  },
};

export interface PdfOptions {
  template?: ResumeTemplate;
  /** Points. 54pt ≈ 19mm. */
  margin?: number;
  fontSize?: number;
  lineSpacing?: number;
  /** Hex accent, e.g. "#c96442". Ignored by minimal and ats_safe. */
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

const A4 = { width: 595.28, height: 841.89 };

interface Theme {
  headingFont: 'sans-bold' | 'serif-bold';
  bodyFont: 'sans' | 'serif';
  monoForTech: boolean;
  headingSize: number;
  nameSize: number;
  useAccent: boolean;
  ruleUnderHeading: boolean;
  uppercaseHeadings: boolean;
  headingLetterSpacing: number;
}

const THEMES: Record<ResumeTemplate, Theme> = {
  modern: {
    headingFont: 'sans-bold', bodyFont: 'sans', monoForTech: false,
    headingSize: 11, nameSize: 20, useAccent: true, ruleUnderHeading: true,
    uppercaseHeadings: true, headingLetterSpacing: 0.6,
  },
  minimal: {
    headingFont: 'sans-bold', bodyFont: 'sans', monoForTech: false,
    headingSize: 10.5, nameSize: 18, useAccent: false, ruleUnderHeading: false,
    uppercaseHeadings: true, headingLetterSpacing: 1.1,
  },
  technical: {
    headingFont: 'sans-bold', bodyFont: 'sans', monoForTech: true,
    headingSize: 10.5, nameSize: 17, useAccent: true, ruleUnderHeading: true,
    uppercaseHeadings: true, headingLetterSpacing: 0.5,
  },
  executive: {
    headingFont: 'serif-bold', bodyFont: 'serif', monoForTech: false,
    headingSize: 11.5, nameSize: 21, useAccent: false, ruleUnderHeading: true,
    uppercaseHeadings: false, headingLetterSpacing: 0,
  },
  ats_safe: {
    headingFont: 'sans-bold', bodyFont: 'sans', monoForTech: false,
    headingSize: 11, nameSize: 16, useAccent: false, ruleUnderHeading: false,
    uppercaseHeadings: true, headingLetterSpacing: 0,
  },
};

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
    .replace(/ /g, ' ')
    .replace(/[‐‑]/g, '-')
    .replace(/₹/g, 'INR ')
    .replace(/→/g, '->')
    .replace(/×/g, 'x')
    // Anything still outside the printable Latin-1 range is dropped rather than
    // allowed to throw mid-render.
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

/** Greedy word wrap against real font metrics. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = toWinAnsi(text).replace(/\s+/g, ' ').trim();
  if (!safe) return [];

  const words = safe.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);

    // A single word longer than the line: break it by character.
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      let chunk = '';
      for (const char of word) {
        if (font.widthOfTextAtSize(chunk + char, size) > maxWidth) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Renderer holding cursor state and handling page breaks. */
class Renderer {
  private page: PDFPage;
  private y: number;
  readonly pages: PDFPage[] = [];

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
    this.page = doc.addPage([A4.width, A4.height]);
    this.pages.push(this.page);
    this.y = A4.height - margin;
  }

  get contentWidth(): number {
    return A4.width - this.margin * 2;
  }

  get remaining(): number {
    return this.y - this.margin;
  }

  private lineHeight(size: number): number {
    return size * this.lineSpacing;
  }

  /** Start a new page. Called only between blocks, never mid-line. */
  newPage(): void {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.pages.push(this.page);
    this.y = A4.height - this.margin;
  }

  ensure(space: number): void {
    if (this.remaining < space) this.newPage();
  }

  gap(points: number): void {
    this.y -= points;
  }

  /** Draw wrapped text. Returns the height consumed. */
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

    for (const line of wrapText(value, font, size, width)) {
      this.ensure(this.lineHeight(size));
      this.page.drawText(line, {
        x: this.margin + indent,
        y: this.y - size,
        size,
        font,
        color,
        ...(opts.letterSpacing ? { characterSpacing: opts.letterSpacing } : {}),
      });
      this.y -= this.lineHeight(size);
    }
  }

  /** A bullet line with a hanging indent, so wrapped lines align. */
  bullet(value: string, opts: { size?: number; indent?: number } = {}): void {
    const font = this.fonts[this.theme.bodyFont === 'serif' ? 'serif' : 'sans'];
    const size = opts.size ?? this.baseSize;
    const indent = opts.indent ?? 0;
    const markerWidth = font.widthOfTextAtSize('- ', size);
    const width = this.contentWidth - indent - markerWidth;
    const lines = wrapText(value, font, size, width);
    if (lines.length === 0) return;

    // Keep at least the first two lines of a bullet together.
    this.ensure(this.lineHeight(size) * Math.min(2, lines.length));

    lines.forEach((line, i) => {
      this.ensure(this.lineHeight(size));
      if (i === 0) {
        this.page.drawText('-', { x: this.margin + indent, y: this.y - size, size, font, color: this.muted });
      }
      this.page.drawText(line, {
        x: this.margin + indent + markerWidth,
        y: this.y - size,
        size,
        font,
        color: this.ink,
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
        end: { x: A4.width - this.margin, y: this.y },
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
      x: A4.width - this.margin - width,
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

/** Generate the PDF. Pure apart from the pdf-lib document it builds. */
export async function generateResumePdf(
  resume: StructuredResume,
  options: PdfOptions = {},
): Promise<PdfResult> {
  const template = options.template ?? 'modern';
  const theme = THEMES[template];
  const single = options.pageMode === 'single';

  const margin = Math.max(28, Math.min(80, options.margin ?? (template === 'executive' ? 62 : 52)));
  const baseSize = Math.max(8, Math.min(12, options.fontSize ?? (single ? 9.5 : 10)));
  const lineSpacing = Math.max(1.05, Math.min(1.8, options.lineSpacing ?? (single ? 1.24 : 1.36)));

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

  /* ------------------------------------------------------------- header -- */
  const c = resume.contact;
  if (c.fullName) {
    r.text(c.fullName, { font: r.boldFont, size: theme.nameSize, color: ink });
  }
  if (c.headline) {
    r.text(c.headline, { size: baseSize + 0.5, color: muted });
  }

  const contactLine = [c.email, c.phone, c.location].filter(Boolean).join('  |  ');
  if (contactLine) {
    r.gap(2);
    r.text(contactLine, { size: baseSize - 0.5, color: muted });
  }
  const links = [c.linkedinUrl, c.githubUrl, c.portfolioUrl, c.websiteUrl].filter(Boolean).join('  |  ');
  if (links) {
    r.text(links, { size: baseSize - 0.5, color: muted });
  }

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
        if (!bullet.text) continue;
        r.bullet(bullet.text, { size: baseSize });
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
      if (project.url) r.text(project.url, { size: baseSize - 1, color: muted });
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
      r.text(line, { size: baseSize, ...(theme.monoForTech ? {} : {}) });
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

  /* ----------------------------------------------------- simple sections -- */
  const simpleSections: [boolean, string, { title: string; detail: string; date: string }[]][] = [
    [
      options.includeCertifications !== false,
      'Certifications',
      resume.certifications.map((x) => ({ title: x.name, detail: x.issuer, date: x.date })),
    ],
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
      const line = [row.title, row.detail].filter(Boolean).join(' - ');
      r.text(line, {
        size: baseSize,
        maxWidth: row.date ? r.widthMinus(row.date, r.italicFont, baseSize - 0.5) : undefined,
      });
    }
  }

  if (options.includeLanguages !== false && resume.languages.length > 0) {
    r.heading('Languages');
    r.text(resume.languages.join(', '), { size: baseSize });
  }

  if (options.includeLinks !== false && resume.links.length > 0) {
    r.heading('Links');
    for (const link of resume.links) {
      r.text([link.label, link.url].filter(Boolean).join(': '), { size: baseSize - 0.5 });
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

export function isResumeTemplate(value: string): value is ResumeTemplate {
  return (RESUME_TEMPLATES as readonly string[]).includes(value);
}
