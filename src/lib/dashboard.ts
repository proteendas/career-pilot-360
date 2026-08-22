/**
 * Dashboard aggregation. Server-only.
 *
 * One function, one round of queries, all scoped by `userId`. Every field is
 * nullable so the UI can render an honest "no data yet" state instead of a
 * fabricated zero.
 */
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  aiUsage,
  applications,
  applicationEvents,
  backgroundTasks,
  getDb,
  isDatabaseConfigured,
  jobMatches,
  outreachDrafts,
  outreachSends,
  resumeAnalyses,
  resumeSuggestions,
  resumeVersions,
  schedules,
} from '@/lib/db';
import { ACTIVE_PIPELINE_STATUSES, type ApplicationStatus } from '@/lib/applications/state';

export interface DashboardData {
  hasAnyResume: boolean;
  atsScore: number | null;
  atsAnalysedAt: string | null;
  defaultResumeVersionId: string | null;
  pendingSuggestions: number;
  acceptedSuggestions: number;
  newMatches: number;
  strongMatches: number;
  applicationsThisWeek: number;
  applicationsTotal: number;
  pipeline: { status: ApplicationStatus; count: number }[];
  interviewCount: number;
  offerCount: number;
  scheduledTasks: number;
  activeSchedules: number;
  outreachDrafted: number;
  outreachSent: number;
  aiTokensThisMonth: number | null;
  aiCallsThisMonth: number;
  recentActivity: {
    id: string;
    eventType: string;
    createdAt: string;
    applicationId: string;
    toStatus: string | null;
  }[];
}

export function emptyDashboard(): DashboardData {
  return {
    hasAnyResume: false,
    atsScore: null,
    atsAnalysedAt: null,
    defaultResumeVersionId: null,
    pendingSuggestions: 0,
    acceptedSuggestions: 0,
    newMatches: 0,
    strongMatches: 0,
    applicationsThisWeek: 0,
    applicationsTotal: 0,
    pipeline: [],
    interviewCount: 0,
    offerCount: 0,
    scheduledTasks: 0,
    activeSchedules: 0,
    outreachDrafted: 0,
    outreachSent: 0,
    aiTokensThisMonth: null,
    aiCallsThisMonth: 0,
    recentActivity: [],
  };
}

const one = (rows: { value: number | string | null }[]): number => Number(rows[0]?.value ?? 0);

export async function loadDashboard(userId: string): Promise<DashboardData> {
  if (!isDatabaseConfigured()) return emptyDashboard();

  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [
    versions,
    latestAnalysis,
    suggestionCounts,
    matchRows,
    appWeek,
    appTotal,
    pipelineRows,
    taskRows,
    scheduleRows,
    draftRows,
    sendRows,
    usageRows,
    activityRows,
  ] = await Promise.all([
    db
      .select({ id: resumeVersions.id, isDefault: resumeVersions.isDefault })
      .from(resumeVersions)
      .where(eq(resumeVersions.userId, userId))
      .orderBy(desc(resumeVersions.isDefault), desc(resumeVersions.createdAt))
      .limit(5),

    db
      .select({
        overallScore: resumeAnalyses.overallScore,
        createdAt: resumeAnalyses.createdAt,
        resumeVersionId: resumeAnalyses.resumeVersionId,
      })
      .from(resumeAnalyses)
      .where(eq(resumeAnalyses.userId, userId))
      .orderBy(desc(resumeAnalyses.createdAt))
      .limit(1),

    db
      .select({ status: resumeSuggestions.status, value: count() })
      .from(resumeSuggestions)
      .where(eq(resumeSuggestions.userId, userId))
      .groupBy(resumeSuggestions.status),

    db
      .select({ matchScore: jobMatches.matchScore, createdAt: jobMatches.createdAt })
      .from(jobMatches)
      .where(eq(jobMatches.userId, userId))
      .orderBy(desc(jobMatches.createdAt))
      .limit(500),

    db
      .select({ value: count() })
      .from(applications)
      .where(and(eq(applications.userId, userId), gte(applications.createdAt, weekAgo))),

    db.select({ value: count() }).from(applications).where(eq(applications.userId, userId)),

    db
      .select({ status: applications.status, value: count() })
      .from(applications)
      .where(eq(applications.userId, userId))
      .groupBy(applications.status),

    db
      .select({ value: count() })
      .from(backgroundTasks)
      .where(and(eq(backgroundTasks.userId, userId), inArray(backgroundTasks.status, ['queued', 'running']))),

    db
      .select({ value: count() })
      .from(schedules)
      .where(and(eq(schedules.userId, userId), eq(schedules.enabled, true))),

    db.select({ value: count() }).from(outreachDrafts).where(eq(outreachDrafts.userId, userId)),

    db
      .select({ value: count() })
      .from(outreachSends)
      .where(and(eq(outreachSends.userId, userId), eq(outreachSends.status, 'sent'))),

    db
      .select({
        tokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}), 0)`,
        calls: count(),
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, monthStart))),

    db
      .select({
        id: applicationEvents.id,
        eventType: applicationEvents.eventType,
        createdAt: applicationEvents.createdAt,
        applicationId: applicationEvents.applicationId,
        toStatus: applicationEvents.toStatus,
      })
      .from(applicationEvents)
      .where(eq(applicationEvents.userId, userId))
      .orderBy(desc(applicationEvents.createdAt))
      .limit(8),
  ]);

  const pending = suggestionCounts.find((r) => r.status === 'pending');
  const accepted = suggestionCounts.filter((r) => r.status === 'accepted' || r.status === 'applied');

  const pipeline = pipelineRows.map((r) => ({
    status: r.status as ApplicationStatus,
    count: Number(r.value),
  }));

  const defaultVersion = versions.find((v) => v.isDefault) ?? versions[0];
  const analysis = latestAnalysis[0];
  const usage = usageRows[0];

  return {
    hasAnyResume: versions.length > 0,
    atsScore: analysis ? analysis.overallScore : null,
    atsAnalysedAt: analysis ? analysis.createdAt.toISOString() : null,
    defaultResumeVersionId: defaultVersion?.id ?? null,
    pendingSuggestions: Number(pending?.value ?? 0),
    acceptedSuggestions: accepted.reduce((n, r) => n + Number(r.value), 0),
    newMatches: matchRows.filter((m) => m.createdAt >= weekAgo).length,
    strongMatches: matchRows.filter((m) => m.matchScore >= 75).length,
    applicationsThisWeek: one(appWeek),
    applicationsTotal: one(appTotal),
    pipeline: pipeline.filter((p) => ACTIVE_PIPELINE_STATUSES.includes(p.status)),
    interviewCount: pipeline.find((p) => p.status === 'interview')?.count ?? 0,
    offerCount: pipeline.find((p) => p.status === 'offer')?.count ?? 0,
    scheduledTasks: one(taskRows),
    activeSchedules: one(scheduleRows),
    outreachDrafted: one(draftRows),
    outreachSent: one(sendRows),
    aiTokensThisMonth: usage ? Number(usage.tokens) : null,
    aiCallsThisMonth: usage ? Number(usage.calls) : 0,
    recentActivity: activityRows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      createdAt: r.createdAt.toISOString(),
      applicationId: r.applicationId,
      toStatus: r.toStatus,
    })),
  };
}
