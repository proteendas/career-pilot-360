/**
 * Job-specific resume tailoring.
 *
 * Tailoring here means EMPHASIS, never invention: reordering skills so the
 * ones the job asks for lead, and reordering bullets within a role so the most
 * relevant ones lead. No bullet text is rewritten by this module — that is
 * `resume/suggestions.ts`'s job, with its own fabrication guard. This module
 * only reorders and optionally trims, so its output is trivially guaranteed
 * to contain no fact the original resume did not.
 */
import type { StructuredResume } from '@/lib/resume/types';
import type { JobWithSource } from '@/lib/jobs/service';
import type { MatchResult } from '@/lib/jobs/match';

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

function relevanceScore(text: string, wantedSkills: Set<string>): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const skill of wantedSkills) {
    if (lower.includes(skill)) score += 1;
  }
  return score;
}

export interface TailorOptions {
  /** Cap the number of bullets kept per role, for a tighter one-page resume. */
  maxBulletsPerRole?: number;
}

/**
 * Reorder (never rewrite) a resume's skills and bullets so the content most
 * relevant to `job` leads. Returns a NEW resume object.
 */
export function tailorResumeForJob(
  resume: StructuredResume,
  job: JobWithSource,
  match: MatchResult | null,
  opts: TailorOptions = {},
): StructuredResume {
  const tailored: StructuredResume = structuredClone(resume);
  const wanted = new Set<string>([
    ...((job.skills as string[]) ?? []).map(normalise),
    ...(match?.matchedRequiredSkills ?? []),
    ...(match?.matchedPreferredSkills ?? []),
  ]);

  // 1. Reorder skill groups: groups containing a wanted skill lead.
  tailored.skills = [...tailored.skills].sort((a, b) => {
    const aScore = a.skills.some((s) => wanted.has(normalise(s))) ? 1 : 0;
    const bScore = b.skills.some((s) => wanted.has(normalise(s))) ? 1 : 0;
    return bScore - aScore;
  });

  // Within each group, wanted skills lead too.
  tailored.skills = tailored.skills.map((group) => ({
    ...group,
    skills: [...group.skills].sort((a, b) => {
      const aWanted = wanted.has(normalise(a)) ? 1 : 0;
      const bWanted = wanted.has(normalise(b)) ? 1 : 0;
      return bWanted - aWanted;
    }),
  }));

  // 2. Within each role, reorder bullets by relevance; optionally cap count.
  //    Roles themselves are never reordered — chronological order in
  //    experience is a factual claim (what happened when) and must not shift.
  tailored.experience = tailored.experience.map((role) => {
    const scored = role.bullets
      .map((bullet, index) => ({ bullet, index, score: relevanceScore(bullet.text, wanted) }))
      // Stable sort: ties keep original order.
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const kept = opts.maxBulletsPerRole ? scored.slice(0, opts.maxBulletsPerRole) : scored;
    return { ...role, bullets: kept.map((s) => s.bullet) };
  });

  // 3. Same for project bullets.
  tailored.projects = tailored.projects.map((project) => {
    const scored = project.bullets
      .map((bullet, index) => ({ bullet, index, score: relevanceScore(bullet.text, wanted) }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    return { ...project, bullets: scored.map((s) => s.bullet) };
  });

  // 4. Projects and roles with zero relevance sink toward the bottom of their
  //    own section, but chronological order among EQUALLY relevant items is
  //    preserved (stable sort).
  const roleRelevance = (role: StructuredResume['experience'][number]) =>
    role.bullets.reduce((n, b) => n + relevanceScore(b.text, wanted), 0) + relevanceScore(role.title, wanted);

  tailored.experience = tailored.experience
    .map((role, index) => ({ role, index, score: roleRelevance(role) }))
    .sort((a, b) => {
      // Only demote a role that scores zero while another scores positively;
      // never reorder two roles that are equally (ir)relevant.
      const aZero = a.score === 0;
      const bZero = b.score === 0;
      if (aZero !== bZero) return aZero ? 1 : -1;
      return a.index - b.index;
    })
    .map((s) => s.role);

  return tailored;
}

/** Human-readable summary of what changed, for the review UI. */
export function describeTailoring(job: JobWithSource, match: MatchResult | null): string[] {
  const notes: string[] = [];
  const skillCount = (match?.matchedRequiredSkills.length ?? 0) + (match?.matchedPreferredSkills.length ?? 0);
  if (skillCount > 0) {
    notes.push(`Skills matching ${job.title} at ${job.company} were moved to the top of each group.`);
  }
  notes.push('Bullets within each role were reordered by relevance to this posting. No wording was changed.');
  notes.push('Roles stay in chronological order — relevance never reorders when you worked somewhere.');
  return notes;
}
