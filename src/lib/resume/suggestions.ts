/**
 * Resume suggestion generation.
 *
 * Two sources, one shape:
 *
 *  1. DETERMINISTIC suggestions derived from ATS findings. These need no AI
 *     key, are reproducible, and are the only kind ever marked
 *     `safeToAutoApply` — because a mechanical rewrite (dropping "Responsible
 *     for") cannot change what a bullet claims.
 *
 *  2. AI suggestions, which may rephrase more freely but are passed through
 *     `checkGrounding` before the user ever sees them. A rewrite that
 *     introduces a figure absent from the user's own material is DISCARDED
 *     here, not shown with a warning — surfacing it at all invites the user to
 *     accept a fabrication.
 *
 * Every suggestion carries evidence: which section it came from and why. A
 * suggestion with no evidence is a bug.
 */
import { z } from 'zod';
import {
  allBullets,
  BULLET_SECTION_PATH_RE,
  checkGrounding,
  resumeToPlainText,
  type StructuredResume,
} from './types';
import type { AtsReport, Priority } from './ats';
import { generateObject } from '@/lib/ai/client';
import { AiError } from '@/lib/ai/types';
import { SAFETY_PREAMBLE, budgetText, fenceUntrusted } from '@/lib/ai/prompts';

/* ------------------------------------------------------------------ types -- */

export type SuggestionCategory =
  | 'weak_verb'
  | 'missing_metric'
  | 'unsupported_claim'
  | 'wording'
  | 'keyword'
  | 'formatting'
  | 'contact'
  | 'structure'
  | 'summary';

export interface Suggestion {
  id: string;
  category: SuggestionCategory;
  priority: Priority;
  /** Dotted path into the structured resume, e.g. experience[0].bullets[2]. */
  sectionPath: string;
  /** Human label for where this applies. */
  sectionLabel: string;
  originalText: string;
  suggestedText: string;
  reason: string;
  evidence: {
    /** Which part of the resume or profile supports this change. */
    source: string;
    quote: string;
    /** How the suggestion was produced. */
    origin: 'deterministic' | 'ai';
  };
  /**
   * True only when applying the change cannot alter the meaning of the text.
   * AI suggestions are never marked safe.
   */
  safeToAutoApply: boolean;
}

export interface SuggestionResult {
  suggestions: Suggestion[];
  /** AI rewrites rejected for introducing unsupported figures. */
  rejected: { text: string; unsupported: string[]; reason: string }[];
  usedAi: boolean;
  provider: string | null;
  model: string | null;
  aiError?: string;
}

/* ------------------------------------------------- deterministic rewriting -- */

/**
 * Mechanical replacements for openings that describe presence rather than
 * contribution. Each maps to a verb that asserts no more than the original.
 *
 * "Responsible for X" → "Owned X" keeps the claim identical: the person was
 * accountable for X either way. Nothing here upgrades a claim.
 */
const VERB_REWRITES: { pattern: RegExp; replace: (rest: string) => string; note: string }[] = [
  {
    // The article is deliberately preserved: "Owned the ledger service" reads
    // correctly, whereas stripping it yields "Owned ledger service".
    pattern: /^responsible for\s+/i,
    replace: (rest) => `Owned ${rest}`,
    note: '“Responsible for” states a duty; “Owned” states the same accountability more directly.',
  },
  {
    pattern: /^worked on\s+/i,
    replace: (rest) => `Built ${rest}`,
    note: '“Worked on” hides your contribution. “Built” is the same claim, stated actively.',
  },
  {
    pattern: /^(?:helped|assisted)\s+(?:with|to|in)\s+/i,
    replace: (rest) => `Contributed to ${rest}`,
    note: '“Helped with” understates your part without being more accurate.',
  },
  {
    pattern: /^(?:was\s+)?involved in\s+/i,
    replace: (rest) => `Contributed to ${rest}`,
    note: '“Involved in” describes proximity, not contribution.',
  },
  {
    pattern: /^participated in\s+/i,
    replace: (rest) => `Contributed to ${rest}`,
    note: '“Participated in” reads as attendance rather than work.',
  },
  {
    pattern: /^tasked with\s+/i,
    replace: (rest) => `Delivered ${rest}`,
    note: '“Tasked with” describes assignment, not outcome.',
  },
  {
    pattern: /^duties included\s+/i,
    replace: (rest) => `Delivered ${rest}`,
    note: 'A duty list is weaker than a statement of what you delivered.',
  },
  {
    pattern: /^part of a team that\s+/i,
    replace: (rest) => `Contributed to a team that ${rest}`,
    note: 'Keeps the team framing but makes your involvement explicit.',
  },
  {
    pattern: /^handled\s+/i,
    replace: (rest) => `Managed ${rest}`,
    note: '“Handled” is imprecise about the nature of the work.',
  },
];

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Apply a mechanical verb rewrite, or return null if none applies. */
export function rewriteWeakOpening(text: string): { text: string; note: string } | null {
  const trimmed = text.trim();
  for (const rule of VERB_REWRITES) {
    const match = trimmed.match(rule.pattern);
    if (!match) continue;
    const rest = trimmed.slice(match[0].length);
    if (!rest) continue;
    // Lower-case the first letter of the remainder so the new verb reads
    // naturally, unless it starts with a proper noun or acronym.
    const startsUpperAcronym = /^[A-Z]{2,}/.test(rest);
    const body = startsUpperAcronym ? rest : rest.charAt(0).toLowerCase() + rest.slice(1);
    return { text: capitalise(rule.replace(body)), note: rule.note };
  }
  return null;
}

/**
 * Build suggestions from the ATS report alone. No AI, no network.
 * These are the baseline every user gets.
 */
export function deterministicSuggestions(resume: StructuredResume, report: AtsReport): Suggestion[] {
  const out: Suggestion[] = [];
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

  // 1. Weak openings → mechanical rewrite. Safe to auto-apply.
  for (const { bullet, owner, path } of allBullets(resume)) {
    const rewrite = rewriteWeakOpening(bullet.text);
    if (!rewrite) continue;
    out.push({
      id: nextId('verb'),
      category: 'weak_verb',
      priority: 'medium',
      sectionPath: path,
      sectionLabel: owner || 'Experience',
      originalText: bullet.text,
      suggestedText: rewrite.text,
      reason: rewrite.note,
      evidence: {
        source: path,
        quote: bullet.text,
        origin: 'deterministic',
      },
      // Word-for-word substitution of the opening only: the claim is unchanged.
      safeToAutoApply: true,
    });
  }

  // 2. Unsupported superlatives → flag for the user to rewrite or remove.
  //    Never auto-applied: only the user knows what actually happened.
  for (const claim of report.unsupportedClaims) {
    out.push({
      id: nextId('claim'),
      category: 'unsupported_claim',
      priority: 'medium',
      sectionPath: claim.path,
      sectionLabel: claim.path === 'summary' ? 'Professional summary' : 'Experience',
      originalText: claim.text,
      suggestedText: '',
      reason: claim.reason,
      evidence: { source: claim.path, quote: claim.text, origin: 'deterministic' },
      safeToAutoApply: false,
    });
  }

  // 3. Bullets with no measurable outcome → ask the user for the number.
  //    Deliberately no suggested text: supplying one would mean inventing it.
  for (const item of report.bulletsMissingMetrics.slice(0, 12)) {
    out.push({
      id: nextId('metric'),
      category: 'missing_metric',
      priority: 'high',
      sectionPath: item.path,
      sectionLabel: 'Experience',
      originalText: item.text,
      suggestedText: '',
      reason:
        'This describes what you did but not its scale or result. If you know a figure — volume, latency, ' +
        'time saved, number of services, team size — add it yourself. CareerPilot360 will not invent one.',
      evidence: { source: item.path, quote: item.text, origin: 'deterministic' },
      safeToAutoApply: false,
    });
  }

  // 4. Missing contact fields.
  for (const finding of report.findings.filter((f) => f.category === 'contact')) {
    out.push({
      id: nextId('contact'),
      category: 'contact',
      priority: finding.priority,
      sectionPath: 'contact',
      sectionLabel: 'Contact details',
      originalText: finding.excerpt ?? '',
      suggestedText: '',
      reason: finding.detail,
      evidence: { source: 'contact', quote: finding.title, origin: 'deterministic' },
      safeToAutoApply: false,
    });
  }

  // 5. Formatting, parsing and structural findings.
  for (const finding of report.findings.filter((f) =>
    ['formatting', 'parsing', 'dates', 'sections'].includes(f.category),
  )) {
    out.push({
      id: nextId('fmt'),
      category: finding.category === 'sections' ? 'structure' : 'formatting',
      priority: finding.priority,
      sectionPath: finding.path ?? 'document',
      sectionLabel: 'Document',
      originalText: finding.excerpt ?? '',
      suggestedText: '',
      reason: `${finding.title}. ${finding.detail}`,
      evidence: { source: finding.path ?? 'document', quote: finding.title, origin: 'deterministic' },
      safeToAutoApply: false,
    });
  }

  // 6. Missing keywords the user may genuinely have.
  if (report.keywords.missing.length > 0) {
    out.push({
      id: nextId('kw'),
      category: 'keyword',
      priority: 'medium',
      sectionPath: 'skills',
      sectionLabel: 'Skills',
      originalText: '',
      suggestedText: '',
      reason:
        'These terms appear in your reference material but not in your resume: ' +
        `${report.keywords.missing.slice(0, 20).join(', ')}. ` +
        'Add only the ones you can genuinely speak to in an interview.',
      evidence: { source: 'keywords', quote: report.keywords.missing.slice(0, 20).join(', '), origin: 'deterministic' },
      safeToAutoApply: false,
    });
  }

  const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
}

/* -------------------------------------------------------- AI enhancement -- */

const aiSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        sectionPath: z.string().max(120).describe('The exact path string given for the bullet, copied verbatim.'),
        originalText: z.string().max(1000),
        suggestedText: z.string().max(1000).describe('The rewritten bullet. Same facts, sharper wording.'),
        reason: z.string().max(400).describe('Why this wording is better. One sentence.'),
        evidenceQuote: z
          .string()
          .max(500)
          .describe('The exact phrase from the source material that supports the rewrite.'),
      }),
    )
    .max(20),
});

export interface AiSuggestionContext {
  userId: string;
  resume: StructuredResume;
  report: AtsReport;
  /** The user's profile as prose, part of the grounding corpus. */
  profileSummary: string;
  /** Optional job description, when tailoring for a specific role. */
  jobDescription?: string;
  targetTitles?: string[];
}

/**
 * Ask the model to sharpen specific bullets, then verify every rewrite is
 * grounded before returning it.
 */
export async function aiSuggestions(ctx: AiSuggestionContext): Promise<{
  suggestions: Suggestion[];
  rejected: SuggestionResult['rejected'];
  provider: string | null;
  model: string | null;
  error?: string;
}> {
  const bullets = allBullets(ctx.resume);
  if (bullets.length === 0) {
    return { suggestions: [], rejected: [], provider: null, model: null };
  }

  // Prioritise the bullets the deterministic pass already flagged as weak.
  const weakPaths = new Set([
    ...ctx.report.findings.filter((f) => f.category === 'language' && f.path).map((f) => f.path!),
    ...ctx.report.bulletsMissingMetrics.map((b) => b.path),
  ]);

  const candidates = [
    ...bullets.filter(({ path }) => weakPaths.has(path)),
    ...bullets.filter(({ path }) => !weakPaths.has(path)),
  ].slice(0, 14);

  const bulletList = candidates
    .map(({ bullet, owner, path }) => `- path: ${path}\n  role: ${owner}\n  text: ${bullet.text}`)
    .join('\n');

  // The grounding corpus is what any figure must be traceable to.
  const resumeText = resumeToPlainText(ctx.resume);
  const corpus = `${resumeText}\n\n${ctx.profileSummary}`;

  const instructions = [
    SAFETY_PREAMBLE,
    '',
    'TASK',
    'Rewrite resume bullets to be clearer and more active, WITHOUT changing what they claim.',
    '',
    'Rules for each rewrite:',
    '- Keep every fact identical. You may reorder, tighten and choose stronger verbs.',
    '- Do NOT add any number, percentage, currency amount, user count, team size or duration that is not already in the source material.',
    '- Do NOT add technologies, employers, titles or outcomes that are not already stated.',
    '- If a bullet cannot be improved without inventing something, omit it from your response entirely.',
    '- `evidenceQuote` must be an exact substring of the source material that supports your rewrite.',
    '- Copy `sectionPath` verbatim from the list. Never invent a path.',
    '',
    ctx.targetTitles?.length ? `The candidate is targeting: ${ctx.targetTitles.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const userContent = [
    'SOURCE MATERIAL — the only facts you may use:',
    '',
    fenceUntrusted('candidate_resume', budgetText(resumeText, 12_000)),
    '',
    fenceUntrusted('candidate_profile', budgetText(ctx.profileSummary, 4_000)),
    ...(ctx.jobDescription
      ? ['', 'The candidate is applying to this role. Emphasise genuinely relevant experience only:', '', fenceUntrusted('job_description', budgetText(ctx.jobDescription, 6_000))]
      : []),
    '',
    'BULLETS TO CONSIDER:',
    bulletList,
  ].join('\n');

  try {
    const res = await generateObject({
      userId: ctx.userId,
      task: 'resume_suggestions',
      schema: aiSuggestionSchema,
      schemaName: 'resume_suggestions',
      schemaDescription: 'Grounded rewrites of resume bullets.',
      temperature: 0.3,
      maxOutputTokens: 3000,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: userContent },
      ],
    });

    const byPath = new Map(candidates.map(({ bullet, owner, path }) => [path, { bullet, owner }]));
    const suggestions: Suggestion[] = [];
    const rejected: SuggestionResult['rejected'] = [];
    let counter = 0;

    for (const raw of res.value.suggestions) {
      const target = byPath.get(raw.sectionPath);
      // A path the model invented, or one outside the candidate set.
      if (!target) continue;
      const suggested = raw.suggestedText.trim();
      if (!suggested || suggested === target.bullet.text.trim()) continue;

      // THE GATE: any figure not present in the user's own material means the
      // rewrite is discarded, not shown.
      const finding = checkGrounding(suggested, corpus, raw.sectionPath);
      if (finding) {
        rejected.push({ text: suggested, unsupported: finding.unsupported, reason: finding.reason });
        continue;
      }

      // The evidence quote must genuinely come from the source material.
      const quote = raw.evidenceQuote.trim();
      const quoteIsReal = quote.length > 0 && corpus.toLowerCase().includes(quote.toLowerCase().slice(0, 60));

      suggestions.push({
        id: `ai-${(counter += 1)}`,
        category: 'wording',
        priority: 'medium',
        sectionPath: raw.sectionPath,
        sectionLabel: target.owner || 'Experience',
        originalText: target.bullet.text,
        suggestedText: suggested,
        reason: raw.reason.trim() || 'Clearer, more active phrasing of the same claim.',
        evidence: {
          source: raw.sectionPath,
          quote: quoteIsReal ? quote : target.bullet.text,
          origin: 'ai',
        },
        // AI rewrites always require a human read, however well-grounded.
        safeToAutoApply: false,
      });
    }

    return { suggestions, rejected, provider: res.provider, model: res.model };
  } catch (err) {
    return {
      suggestions: [],
      rejected: [],
      provider: null,
      model: null,
      error: err instanceof AiError ? err.message : 'The AI suggestion pass failed.',
    };
  }
}

const bulletRewriteSchema = z.object({
  suggestedText: z.string().max(1000),
});

export interface RewriteTextContext {
  userId: string;
  resume: StructuredResume;
  profileSummary: string;
  sectionPath: string;
  originalText: string;
  reason: string;
}

/**
 * Ask the model to rewrite ONE piece of text (a bullet or the summary) to
 * address a specific critique — used by the "AI rewrite" action on a single
 * suggestion, as opposed to `aiSuggestions`' whole-resume pass.
 */
export async function rewriteSuggestionText(
  ctx: RewriteTextContext,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const resumeText = resumeToPlainText(ctx.resume);
  const corpus = `${resumeText}\n\n${ctx.profileSummary}`;

  const instructions = [
    SAFETY_PREAMBLE,
    '',
    'TASK',
    'Rewrite ONE resume bullet (or summary line) to address the specific critique given, without changing what it claims.',
    '',
    'Rules:',
    '- Keep every fact identical. You may reorder, tighten and choose stronger verbs.',
    '- Do NOT add any number, percentage, currency amount, user count, team size or duration that is not already in the source material.',
    '- Do NOT add technologies, employers, titles or outcomes that are not already stated.',
    '- If the critique asks for information you do not have (e.g. a missing metric), improve the wording as best you can WITHOUT inventing the missing figure.',
    '- Return only the rewritten text, nothing else.',
  ].join('\n');

  const userContent = [
    'SOURCE MATERIAL — the only facts you may use:',
    '',
    fenceUntrusted('candidate_resume', budgetText(resumeText, 12_000)),
    '',
    fenceUntrusted('candidate_profile', budgetText(ctx.profileSummary, 4_000)),
    '',
    'TEXT TO REWRITE:',
    fenceUntrusted('original_text', ctx.originalText || '(empty — write a first draft that fits the critique)'),
    '',
    'CRITIQUE TO ADDRESS:',
    fenceUntrusted('critique', ctx.reason),
  ].join('\n');

  try {
    const res = await generateObject({
      userId: ctx.userId,
      task: 'resume_suggestions',
      schema: bulletRewriteSchema,
      schemaName: 'bullet_rewrite',
      schemaDescription: 'A single grounded rewrite of one resume bullet or summary line.',
      temperature: 0.3,
      maxOutputTokens: 600,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: userContent },
      ],
    });

    const suggested = res.value.suggestedText.trim();
    if (!suggested) return { ok: false, error: 'The AI did not return a rewrite.' };

    // Same gate as the whole-resume pass: a figure the user never supplied is
    // refused, not shown with a warning.
    const finding = checkGrounding(suggested, corpus, ctx.sectionPath);
    if (finding) {
      return {
        ok: false,
        error:
          `That rewrite introduced figures not present in your resume or profile (${finding.unsupported.join(', ')}). ` +
          'Add the underlying detail to your profile first, or try again.',
      };
    }

    return { ok: true, text: suggested };
  } catch (err) {
    return { ok: false, error: err instanceof AiError ? err.message : 'The AI rewrite failed.' };
  }
}

/**
 * Full suggestion pass: deterministic always, AI when available.
 * Never throws — a missing or failing provider simply yields the
 * deterministic set, and `usedAi` tells the UI which happened.
 */
export async function generateSuggestions(ctx: AiSuggestionContext): Promise<SuggestionResult> {
  const deterministic = deterministicSuggestions(ctx.resume, ctx.report);
  const ai = await aiSuggestions(ctx);

  // Deterministic suggestions win on conflict: a mechanical rewrite of the same
  // bullet is safer than a generated one, and showing both is noise.
  const claimedPaths = new Set(
    deterministic.filter((s) => s.category === 'weak_verb').map((s) => s.sectionPath),
  );
  const aiFiltered = ai.suggestions.filter((s) => !claimedPaths.has(s.sectionPath));

  return {
    suggestions: [...deterministic, ...aiFiltered],
    rejected: ai.rejected,
    usedAi: ai.suggestions.length > 0 || ai.rejected.length > 0,
    provider: ai.provider,
    model: ai.model,
    ...(ai.error ? { aiError: ai.error } : {}),
  };
}

/* ------------------------------------------------------------ application -- */

/**
 * Apply a suggestion to a resume, returning a NEW resume object.
 * Never mutates the input: version history depends on the previous state
 * remaining intact.
 */
export function applySuggestion(
  resume: StructuredResume,
  suggestion: { sectionPath: string; suggestedText: string },
  overrideText?: string,
): { resume: StructuredResume; applied: boolean } {
  const text = (overrideText ?? suggestion.suggestedText).trim();
  if (!text) return { resume, applied: false };

  const next: StructuredResume = structuredClone(resume);
  const match = suggestion.sectionPath.match(BULLET_SECTION_PATH_RE);

  if (match) {
    const [, section, ownerIndexRaw, bulletIndexRaw] = match as unknown as [string, 'experience' | 'projects', string, string];
    const ownerIndex = Number(ownerIndexRaw);
    const bulletIndex = Number(bulletIndexRaw);
    const owner = next[section][ownerIndex];
    const bullet = owner?.bullets[bulletIndex];
    if (!bullet) return { resume, applied: false };
    bullet.text = text;
    // Mark provenance so the fabrication guard keeps policing it.
    bullet.source = overrideText ? 'user' : 'suggested';
    return { resume: next, applied: true };
  }

  if (suggestion.sectionPath === 'summary') {
    next.summary = text;
    next.summarySource = overrideText ? 'user' : 'suggested';
    return { resume: next, applied: true };
  }

  // Paths without a concrete target (contact, formatting advice, keywords) are
  // guidance for the user rather than a mechanical edit.
  return { resume, applied: false };
}

/** Apply every suggestion flagged safe. Returns how many took effect. */
export function applyAllSafe(
  resume: StructuredResume,
  suggestions: Suggestion[],
): { resume: StructuredResume; appliedIds: string[] } {
  let current = resume;
  const appliedIds: string[] = [];

  for (const suggestion of suggestions) {
    if (!suggestion.safeToAutoApply || !suggestion.suggestedText) continue;
    const result = applySuggestion(current, suggestion);
    if (result.applied) {
      current = result.resume;
      appliedIds.push(suggestion.id);
    }
  }

  return { resume: current, appliedIds };
}
