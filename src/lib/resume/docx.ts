/**
 * Server-side resume DOCX generation with `docx`.
 *
 * Mirrors `pdf.ts` section-by-section, driven by the same `Theme` table, so a
 * template looks the same whichever format the user downloads. Unlike the PDF
 * renderer, Word does its own text wrapping and pagination — this file only
 * describes paragraphs and runs, never coordinates.
 *
 * The same ATS rules apply: single column, no tables, no text boxes, real
 * hyperlinks via `ExternalHyperlink` rather than visible raw URLs.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
  UnderlineType,
  type ParagraphChild,
} from 'docx';

type Alignment = (typeof AlignmentType)[keyof typeof AlignmentType];
import { contentHash } from '@/lib/security';
import type { StructuredResume } from './types';
import { PAGE_SIZES, THEMES, type ResumeTemplate } from './theme';
import type { PdfOptions } from './pdf';
import { parseInlineLinks, splitMarkdownLink } from './markdown-link';

export type DocxOptions = PdfOptions;

export interface DocxResult {
  bytes: Uint8Array;
  contentHash: string;
  template: ResumeTemplate;
}

const INK = '1F1F1C';
const MUTED = '6B6963';
const LINK_COLOR = '2A5DB0';
const DEFAULT_ACCENT = 'C86442';

const PT = (pt: number) => Math.round(pt * 20); // points -> twips
const HALF_PT = (pt: number) => Math.round(pt * 2); // points -> half-points (docx run size unit)

function hex(value: string | undefined, fallback: string): string {
  const v = (value ?? '').trim().replace('#', '');
  return /^[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : fallback;
}

function formatRange(start: string, end: string, current: boolean): string {
  const to = current ? 'Present' : end;
  if (start && to) return `${start} - ${to}`;
  return start || to || '';
}

/** A run, or a hyperlink run when `url` is set — the single building block every section uses. */
function textOrLink(
  text: string,
  opts: { url?: string; bold?: boolean; italics?: boolean; size?: number; color?: string } = {},
): ParagraphChild {
  const link = !opts.url ? splitMarkdownLink(text) : null;
  const label = link?.label ?? text;
  const url = opts.url ?? link?.url;

  if (url) {
    return new ExternalHyperlink({
      link: url,
      children: [
        new TextRun({
          text: label,
          bold: opts.bold,
          italics: opts.italics,
          size: opts.size,
          color: LINK_COLOR,
          underline: { type: UnderlineType.SINGLE },
        }),
      ],
    });
  }

  return new TextRun({ text: label, bold: opts.bold, italics: opts.italics, size: opts.size, color: opts.color });
}

export async function generateResumeDocx(
  resume: StructuredResume,
  options: DocxOptions = {},
): Promise<DocxResult> {
  const template = options.template ?? 'classic';
  const theme = THEMES[template];
  const single = options.pageMode === 'single';

  const marginPt = Math.max(28, Math.min(80, options.margin ?? theme.defaultMargin));
  const baseSizePt = Math.max(
    8,
    Math.min(12, options.fontSize ?? (single ? theme.defaultFontSize - 0.5 : theme.defaultFontSize)),
  );
  const lineSpacing = Math.max(
    1.05,
    Math.min(1.8, options.lineSpacing ?? (single ? theme.defaultLineSpacing - 0.12 : theme.defaultLineSpacing)),
  );

  const page = PAGE_SIZES[theme.pageSize];
  const marginTwips = PT(marginPt);
  const contentWidthTwips = PT(page.width) - marginTwips * 2;
  const lineTwips = Math.round(lineSpacing * 240);
  const accent = hex(options.accentColor, DEFAULT_ACCENT);
  const align = theme.centerHeader ? AlignmentType.CENTER : AlignmentType.LEFT;

  const baseSpacing = { after: PT(4), line: lineTwips, lineRule: 'auto' as const };
  const bodyRunOpts = { size: HALF_PT(baseSizePt), color: INK };

  const children: Paragraph[] = [];

  const heading = (label: string) => {
    const text = theme.uppercaseHeadings ? label.toUpperCase() : label;
    children.push(
      new Paragraph({
        spacing: { before: PT(10), after: PT(4), line: lineTwips, lineRule: 'auto' },
        border: theme.ruleUnderHeading
          ? { bottom: { style: BorderStyle.SINGLE, size: 4, space: 2, color: theme.useAccent ? accent : MUTED } }
          : undefined,
        children: [
          new TextRun({
            text,
            bold: true,
            size: HALF_PT(theme.headingSize),
            color: theme.useAccent ? accent : INK,
          }),
        ],
      }),
    );
  };

  const paragraph = (runs: ParagraphChild[], opts: { spacing?: typeof baseSpacing; align?: Alignment } = {}) => {
    if (runs.length === 0) return;
    children.push(new Paragraph({ children: runs, spacing: opts.spacing ?? baseSpacing, alignment: opts.align }));
  };

  /**
   * Runs for free text that may contain inline `[label](url)` links the
   * parser recovered from the original document — each becomes a real
   * `ExternalHyperlink`, everything else stays plain text.
   */
  const inlineRuns = (
    value: string,
    opts: { size?: number; color?: string; italics?: boolean; bold?: boolean } = {},
  ): ParagraphChild[] =>
    parseInlineLinks(value)
      .filter((seg) => seg.text)
      .map((seg) =>
        textOrLink(seg.text, {
          url: seg.url,
          size: HALF_PT(opts.size ?? baseSizePt),
          color: opts.color ?? INK,
          italics: opts.italics,
          bold: opts.bold,
        }),
      );

  const plainText = (value: string, opts: { size?: number; color?: string; italics?: boolean } = {}) => {
    if (!value) return;
    paragraph(inlineRuns(value, opts));
  };

  /** "Title ................ dates" on one line via a right tab stop. */
  const titleWithDate = (titleRuns: ParagraphChild[], date: string) => {
    if (titleRuns.length === 0 && !date) return;
    const runs = [...titleRuns];
    if (date) {
      runs.push(
        new TextRun({ text: '\t' }),
        new TextRun({ text: date, italics: true, size: HALF_PT(baseSizePt - 0.5), color: MUTED }),
      );
    }
    children.push(
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: contentWidthTwips }],
        spacing: baseSpacing,
        children: runs,
      }),
    );
  };

  const bullet = (text: string) => {
    if (!text) return;
    children.push(
      new Paragraph({
        indent: { left: PT(14), hanging: PT(14) },
        spacing: baseSpacing,
        children: [
          new TextRun({ text: '•  ', size: HALF_PT(baseSizePt), color: MUTED }),
          ...inlineRuns(text, { size: baseSizePt }),
        ],
      }),
    );
  };

  /* ------------------------------------------------------------- header -- */
  const c = resume.contact;
  if (c.fullName) {
    paragraph([new TextRun({ text: c.fullName, bold: true, size: HALF_PT(theme.nameSize), color: INK })], {
      align,
      spacing: { after: PT(2), line: lineTwips, lineRule: 'auto' },
    });
  }
  if (c.headline) {
    paragraph([new TextRun({ text: c.headline, size: HALF_PT(baseSizePt + 0.5), color: MUTED })], {
      align,
      spacing: { after: PT(2), line: lineTwips, lineRule: 'auto' },
    });
  }

  const contactBits = [c.email, c.phone, c.location].filter(Boolean);
  if (contactBits.length) {
    paragraph(
      contactBits.flatMap((bit, i) => {
        const run = new TextRun({ text: bit, size: HALF_PT(baseSizePt - 0.5), color: MUTED });
        return i === 0 ? [run] : [new TextRun({ text: '   |   ', size: HALF_PT(baseSizePt - 0.5), color: MUTED }), run];
      }),
      { align, spacing: { after: PT(2), line: lineTwips, lineRule: 'auto' } },
    );
  }

  const linkBits: { label: string; url: string }[] = [];
  if (c.linkedinUrl) linkBits.push({ label: 'LinkedIn', url: c.linkedinUrl });
  if (c.githubUrl) linkBits.push({ label: 'GitHub', url: c.githubUrl });
  if (c.portfolioUrl) linkBits.push({ label: 'Portfolio', url: c.portfolioUrl });
  if (c.websiteUrl) linkBits.push({ label: 'Website', url: c.websiteUrl });
  if (linkBits.length) {
    paragraph(
      linkBits.flatMap((bit, i) => {
        const run = textOrLink(bit.label, { url: bit.url, size: HALF_PT(baseSizePt - 0.5) });
        return i === 0
          ? [run]
          : [new TextRun({ text: '   |   ', size: HALF_PT(baseSizePt - 0.5), color: MUTED }), run];
      }),
      { align, spacing: baseSpacing },
    );
  }

  /* ------------------------------------------------------------ summary -- */
  if (options.includeSummary !== false && resume.summary) {
    heading('Professional Summary');
    plainText(resume.summary);
  }

  /* --------------------------------------------------------- experience -- */
  if (resume.experience.length > 0) {
    heading('Experience');
    resume.experience.forEach((exp, index) => {
      if (index > 0) children.push(new Paragraph({ spacing: { after: PT(2) }, children: [] }));
      const dates = formatRange(exp.startDate, exp.endDate, exp.current);
      const titleLine = [exp.title, exp.company].filter(Boolean).join(' - ');
      if (titleLine) {
        titleWithDate([new TextRun({ text: titleLine, bold: true, size: HALF_PT(baseSizePt + 0.5), color: INK })], dates);
      } else if (dates) {
        plainText(dates, { italics: true, size: baseSizePt - 0.5, color: MUTED });
      }
      if (exp.location) plainText(exp.location, { size: baseSizePt - 0.5, color: MUTED });
      if (exp.summary) plainText(exp.summary);
      for (const b of exp.bullets) if (b.text) bullet(b.text);
      if (exp.technologies.length > 0) {
        plainText(`Technologies: ${exp.technologies.join(', ')}`, { size: baseSizePt - 1, color: MUTED });
      }
    });
  }

  /* ----------------------------------------------------------- projects -- */
  if (options.includeProjects !== false && resume.projects.length > 0) {
    heading('Projects');
    resume.projects.forEach((project, index) => {
      if (index > 0) children.push(new Paragraph({ spacing: { after: PT(2) }, children: [] }));
      const dates = formatRange(project.startDate, project.endDate, false);
      const nameLine = [project.name, project.role].filter(Boolean).join(' - ');
      if (nameLine) {
        titleWithDate([new TextRun({ text: nameLine, bold: true, size: HALF_PT(baseSizePt + 0.5), color: INK })], dates);
      }
      if (project.url) paragraph([textOrLink(project.url, { size: HALF_PT(baseSizePt - 1) })]);
      if (project.description) plainText(project.description);
      for (const b of project.bullets) if (b.text) bullet(b.text);
      if (project.technologies.length > 0) {
        plainText(`Technologies: ${project.technologies.join(', ')}`, { size: baseSizePt - 1, color: MUTED });
      }
    });
  }

  /* ------------------------------------------------------------- skills -- */
  if (resume.skills.length > 0) {
    heading('Skills');
    for (const group of resume.skills) {
      if (group.skills.length === 0) continue;
      const line = group.category ? `${group.category}: ${group.skills.join(', ')}` : group.skills.join(', ');
      plainText(line);
    }
  }

  /* ---------------------------------------------------------- education -- */
  if (resume.education.length > 0) {
    heading('Education');
    resume.education.forEach((edu, index) => {
      if (index > 0) children.push(new Paragraph({ spacing: { after: PT(2) }, children: [] }));
      const dates = formatRange(edu.startDate, edu.endDate, false);
      const degreeLine = [edu.degree, edu.field].filter(Boolean).join(', ');
      if (degreeLine) {
        titleWithDate([new TextRun({ text: degreeLine, bold: true, size: HALF_PT(baseSizePt), color: INK })], dates);
      }
      const instLine = [edu.institution, edu.location, edu.grade].filter(Boolean).join('  |  ');
      if (instLine) plainText(instLine, { size: baseSizePt - 0.5, color: MUTED });
      for (const detail of edu.details) bullet(detail);
    });
  }

  /* ----------------------------------------------------- certifications -- */
  if (options.includeCertifications !== false && resume.certifications.length > 0) {
    heading('Certifications');
    for (const cert of resume.certifications) {
      if (!cert.name) continue;
      const nameRuns: ParagraphChild[] = [textOrLink(cert.name, { bold: true, size: HALF_PT(baseSizePt) })];
      if (cert.issuer) nameRuns.push(new TextRun({ text: ` - ${cert.issuer}`, size: HALF_PT(baseSizePt), color: INK }));
      titleWithDate(nameRuns, cert.date);

      const detailRuns: ParagraphChild[] = [];
      const hasNameLink = Boolean(splitMarkdownLink(cert.name));
      if (cert.credentialId) {
        detailRuns.push(new TextRun({ text: `Credential ID: ${cert.credentialId}`, size: HALF_PT(baseSizePt - 1), color: MUTED }));
      }
      if (cert.url && !hasNameLink) {
        if (detailRuns.length) detailRuns.push(new TextRun({ text: '   |   ', size: HALF_PT(baseSizePt - 1), color: MUTED }));
        detailRuns.push(textOrLink('Verify credential', { url: cert.url, size: HALF_PT(baseSizePt - 1) }));
      }
      if (detailRuns.length) paragraph(detailRuns);
    }
  }

  /* ----------------------------------------------------- simple sections -- */
  const simpleSections: [boolean, string, { title: string; detail: string; date: string }[]][] = [
    [options.includeAwards !== false, 'Awards', resume.awards.map((x) => ({ title: x.title, detail: x.detail, date: x.date }))],
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

  for (const [include, label, entries] of simpleSections) {
    const rows = entries.filter((e) => e.title);
    if (!include || rows.length === 0) continue;
    heading(label);
    for (const row of rows) {
      const titleRuns: ParagraphChild[] = [textOrLink(row.title, { size: HALF_PT(baseSizePt) })];
      if (row.detail) titleRuns.push(new TextRun({ text: ` - ${row.detail}`, size: HALF_PT(baseSizePt), color: INK }));
      titleWithDate(titleRuns, row.date);
    }
  }

  if (options.includeLanguages !== false && resume.languages.length > 0) {
    heading('Languages');
    plainText(resume.languages.join(', '));
  }

  if (options.includeLinks !== false && resume.links.length > 0) {
    heading('Links');
    for (const link of resume.links) {
      paragraph([textOrLink(link.label || link.url, { url: link.url, size: HALF_PT(baseSizePt - 0.5) })]);
    }
  }

  if (options.includeAdditional !== false && resume.additional) {
    heading('Additional Information');
    plainText(resume.additional);
  }

  for (const section of resume.unparsedSections) {
    if (!section.body) continue;
    heading(section.heading || 'Additional');
    plainText(section.body);
  }

  const doc = new Document({
    creator: 'CareerPilot360',
    title: `${resume.contact.fullName || 'Resume'} - Resume`,
    styles: {
      default: {
        document: { run: bodyRunOpts },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PT(page.width), height: PT(page.height) },
            margin: { top: marginTwips, bottom: marginTwips, left: marginTwips, right: marginTwips },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const bytes = new Uint8Array(buffer);
  return { bytes, contentHash: await contentHash(bytes), template };
}
