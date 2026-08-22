/**
 * Shared visual theme table for resume export.
 *
 * One theme drives both renderers (`pdf.ts` and `docx.ts`) so a template looks
 * the same regardless of which file format the user downloads.
 */

export const RESUME_TEMPLATES = ['classic', 'modern', 'minimal', 'technical', 'executive', 'ats_safe'] as const;
export type ResumeTemplate = (typeof RESUME_TEMPLATES)[number];

export const TEMPLATE_META: Record<
  ResumeTemplate,
  { label: string; description: string; atsNote: string }
> = {
  classic: {
    label: 'Classic',
    description: 'Centered header, a serif face, and a hairline rule under each heading. Compact, letter-sized.',
    atsNote: 'Single column, text-only, no shading. Matches the widely-used plain resume-template layout.',
  },
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

export interface Theme {
  headingFont: 'sans-bold' | 'serif-bold';
  bodyFont: 'sans' | 'serif';
  monoForTech: boolean;
  headingSize: number;
  nameSize: number;
  useAccent: boolean;
  ruleUnderHeading: boolean;
  uppercaseHeadings: boolean;
  headingLetterSpacing: number;
  /** US Letter for `classic` (matches the shared template); A4 for everything else. */
  pageSize: 'letter' | 'a4';
  /** Name and contact line centered rather than left-aligned. */
  centerHeader: boolean;
  /** Default point size and margin when the caller does not specify one. */
  defaultFontSize: number;
  defaultLineSpacing: number;
  defaultMargin: number;
}

export const THEMES: Record<ResumeTemplate, Theme> = {
  classic: {
    headingFont: 'serif-bold', bodyFont: 'serif', monoForTech: false,
    headingSize: 9.5, nameSize: 14.5, useAccent: false, ruleUnderHeading: true,
    uppercaseHeadings: true, headingLetterSpacing: 0,
    pageSize: 'letter', centerHeader: true,
    defaultFontSize: 8, defaultLineSpacing: 1.15, defaultMargin: 36,
  },
  modern: {
    headingFont: 'sans-bold', bodyFont: 'sans', monoForTech: false,
    headingSize: 11, nameSize: 20, useAccent: true, ruleUnderHeading: true,
    uppercaseHeadings: true, headingLetterSpacing: 0.6,
    pageSize: 'a4', centerHeader: false,
    defaultFontSize: 10, defaultLineSpacing: 1.36, defaultMargin: 52,
  },
  minimal: {
    headingFont: 'sans-bold', bodyFont: 'sans', monoForTech: false,
    headingSize: 10.5, nameSize: 18, useAccent: false, ruleUnderHeading: false,
    uppercaseHeadings: true, headingLetterSpacing: 1.1,
    pageSize: 'a4', centerHeader: false,
    defaultFontSize: 10, defaultLineSpacing: 1.36, defaultMargin: 52,
  },
  technical: {
    headingFont: 'sans-bold', bodyFont: 'sans', monoForTech: true,
    headingSize: 10.5, nameSize: 17, useAccent: true, ruleUnderHeading: true,
    uppercaseHeadings: true, headingLetterSpacing: 0.5,
    pageSize: 'a4', centerHeader: false,
    defaultFontSize: 10, defaultLineSpacing: 1.36, defaultMargin: 52,
  },
  executive: {
    headingFont: 'serif-bold', bodyFont: 'serif', monoForTech: false,
    headingSize: 11.5, nameSize: 21, useAccent: false, ruleUnderHeading: true,
    uppercaseHeadings: false, headingLetterSpacing: 0,
    pageSize: 'a4', centerHeader: false,
    defaultFontSize: 10, defaultLineSpacing: 1.36, defaultMargin: 62,
  },
  ats_safe: {
    headingFont: 'sans-bold', bodyFont: 'sans', monoForTech: false,
    headingSize: 11, nameSize: 16, useAccent: false, ruleUnderHeading: false,
    uppercaseHeadings: true, headingLetterSpacing: 0,
    pageSize: 'a4', centerHeader: false,
    defaultFontSize: 10, defaultLineSpacing: 1.36, defaultMargin: 52,
  },
};

export function isResumeTemplate(value: string): value is ResumeTemplate {
  return (RESUME_TEMPLATES as readonly string[]).includes(value);
}

export const PAGE_SIZES: Record<'letter' | 'a4', { width: number; height: number }> = {
  // Points. A4 at 72dpi; US Letter at 72dpi.
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};
