/**
 * The assistant's fixed tool allow-list. Server-only.
 *
 * Every tool here is read-only: it looks up data already computed elsewhere
 * and returns it as JSON. None of them sends anything, submits anything, or
 * changes any stored state — that is a deliberate scope boundary for this
 * pass, not an oversight. A future mutating tool would need to render as a
 * pending action the user explicitly confirms before it runs (the
 * `messages.pendingConfirmation` / `confirmedAt` columns exist for exactly
 * that), the same way every other outward-facing action in this app works.
 * Don't add a tool here that changes data without building that flow first.
 */
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, jobs, outreachDrafts, type OutreachDraft } from '@/lib/db';
import { loadDashboard, type DashboardData } from '@/lib/dashboard';
import { listApplications } from '@/lib/applications/service';
import { listMatches } from '@/lib/jobs/match-service';
import { APPLICATION_STATUSES, STATUS_META, type ApplicationStatus } from '@/lib/applications/state';
import { getDefaultVersion } from '@/lib/resume/service';
import { allSkills, parseStructuredResume } from '@/lib/resume/types';
import type { ToolDefinition } from './types';

export const ASSISTANT_TOOL_NAMES = [
  'get_dashboard_summary',
  'get_resume_summary',
  'list_job_matches',
  'list_applications',
  'list_outreach_drafts',
] as const;
export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    name: 'get_dashboard_summary',
    description:
      "The user's current stats: resume ATS score, pending suggestions, match counts, application pipeline, outreach and AI usage. Use this for any general 'how am I doing' question.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_resume_summary',
    description:
      "The content of the user's current default resume — headline, summary, skills, work history " +
      '(titles, companies, technologies, top bullets), education and certifications. Use this for any ' +
      "question about what's in the user's resume, what roles or job titles would suit them, or how their " +
      'experience compares to a role.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_job_matches',
    description: 'The highest-scored job matches for the user, most recent first.',
    parameters: {
      type: 'object',
      properties: {
        minScore: { type: 'number', description: 'Only matches at or above this score (0-100).' },
        limit: { type: 'number', description: 'Max results, default 10, max 25.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_applications',
    description: 'The user\'s tracked applications, optionally filtered by status.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'array',
          items: { type: 'string', enum: [...APPLICATION_STATUSES] },
          description: 'Restrict to these statuses. Omit for all.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_outreach_drafts',
    description: "The user's outreach drafts to recruiters/contacts — subject, status, recipient.",
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'approved', 'sent', 'failed', 'cancelled'] },
      },
      additionalProperties: false,
    },
  },
];

export function isAssistantToolName(name: string): name is AssistantToolName {
  return (ASSISTANT_TOOL_NAMES as readonly string[]).includes(name);
}

/* -------------------------------------------------------------- executors */

function summarizeDashboard(d: DashboardData) {
  return {
    atsScore: d.atsScore,
    pendingSuggestions: d.pendingSuggestions,
    acceptedSuggestions: d.acceptedSuggestions,
    strongMatches: d.strongMatches,
    newMatchesThisWeek: d.newMatches,
    applicationsThisWeek: d.applicationsThisWeek,
    applicationsTotal: d.applicationsTotal,
    pipeline: d.pipeline,
    interviewCount: d.interviewCount,
    offerCount: d.offerCount,
    outreachDrafted: d.outreachDrafted,
    outreachSent: d.outreachSent,
    aiTokensThisMonth: d.aiTokensThisMonth,
  };
}

/** Compact enough to stay within a tool-result token budget; still enough to reason about fit. */
function summarizeResume(resumeRaw: unknown) {
  const resume = parseStructuredResume(resumeRaw);
  const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

  return {
    headline: resume.contact.headline || null,
    summary: resume.summary ? truncate(resume.summary, 600) : null,
    skills: allSkills(resume).slice(0, 60),
    experience: resume.experience.slice(0, 8).map((exp) => ({
      title: exp.title,
      company: exp.company,
      current: exp.current,
      technologies: exp.technologies,
      highlights: exp.bullets.slice(0, 2).map((b) => truncate(b.text, 200)),
    })),
    education: resume.education.map((e) => ({ degree: e.degree, field: e.field, institution: e.institution })),
    certifications: resume.certifications.map((c) => c.name).filter(Boolean),
  };
}

const listJobMatchesArgs = z.object({
  minScore: z.number().min(0).max(100).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

const listApplicationsArgs = z.object({
  status: z.array(z.enum(APPLICATION_STATUSES)).optional(),
});

const listOutreachDraftsArgs = z.object({
  status: z.enum(['draft', 'approved', 'sent', 'failed', 'cancelled']).optional(),
});

/** Validates arguments and runs one tool for `userId`. Throws on bad input or unknown tool. */
export async function executeAssistantTool(name: string, rawArgs: unknown, userId: string): Promise<unknown> {
  if (!isAssistantToolName(name)) throw new Error(`Unknown tool: ${name}`);
  const db = getDb();

  switch (name) {
    case 'get_dashboard_summary': {
      const data = await loadDashboard(userId);
      return summarizeDashboard(data);
    }

    case 'get_resume_summary': {
      const version = await getDefaultVersion(userId);
      if (!version) return { hasResume: false, message: 'The user has not uploaded a resume yet.' };
      return { hasResume: true, versionName: version.name, ...summarizeResume(version.structuredContent) };
    }

    case 'list_job_matches': {
      const args = listJobMatchesArgs.parse(rawArgs ?? {});
      const items = await listMatches(userId, { minScore: args.minScore, limit: args.limit ?? 10 });
      return items.map((i) => ({
        jobId: i.job.id,
        title: i.job.title,
        company: i.job.company,
        score: i.match.score,
        matchedRequiredSkills: i.match.matchedRequiredSkills,
      }));
    }

    case 'list_applications': {
      const args = listApplicationsArgs.parse(rawArgs ?? {});
      const apps = await listApplications(userId, { status: args.status as ApplicationStatus[] | undefined });
      const jobIds = [...new Set(apps.map((a) => a.jobId))];
      const jobRows = jobIds.length
        ? await db.select({ id: jobs.id, title: jobs.title, company: jobs.company }).from(jobs).where(inArray(jobs.id, jobIds))
        : [];
      const jobMap = new Map(jobRows.map((j) => [j.id, j]));
      return apps.slice(0, 30).map((a) => ({
        applicationId: a.id,
        status: a.status,
        statusLabel: STATUS_META[a.status as ApplicationStatus]?.label ?? a.status,
        jobTitle: jobMap.get(a.jobId)?.title ?? null,
        company: jobMap.get(a.jobId)?.company ?? null,
        updatedAt: a.updatedAt.toISOString(),
      }));
    }

    case 'list_outreach_drafts': {
      const args = listOutreachDraftsArgs.parse(rawArgs ?? {});
      const conditions = [eq(outreachDrafts.userId, userId)];
      if (args.status) conditions.push(eq(outreachDrafts.status, args.status));
      const rows: OutreachDraft[] = await db
        .select()
        .from(outreachDrafts)
        .where(and(...conditions))
        .limit(30);
      return rows.map((r) => ({ draftId: r.id, subject: r.subject, status: r.status, updatedAt: r.updatedAt.toISOString() }));
    }
  }
}
