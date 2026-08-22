/**
 * Job persistence: import, dedupe against what is already stored, list, filter.
 * Server-only.
 *
 * Ownership model:
 *   ownerUserId = null   a shared job from a public board or authorised API
 *   ownerUserId = <id>   a job this user imported privately (pasted URL,
 *                        manual entry, external link)
 *
 * Reads always return the union of shared jobs and the caller's own; they never
 * return another user's private import.
 */
import { and, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { getDb, jobs, jobSources, savedJobs, type Job } from '@/lib/db';
import { NotFoundError } from '@/lib/db/tenant';
import { contentHash, sanitizeLabel } from '@/lib/security';
import { recordAudit } from '@/lib/audit';
import { computeDedupeKey } from './dedupe';
import { ensureSourceId } from './search';
import { SOURCE_TYPE_LABELS, findSourceDefinition, type JobSourceType } from './registry';
import type { NormalizedJob } from './types';

/* ---------------------------------------------------------------- import -- */

export interface ImportResult {
  jobId: string;
  created: boolean;
  /** Set when an existing row matched, explaining which rule matched. */
  duplicateOf?: string;
}

/**
 * Persist a normalised job, or return the existing row when it is a duplicate.
 *
 * The unique index on `dedupe_key` is the real guarantee: two concurrent
 * imports of the same posting cannot create two rows, because the second
 * insert conflicts and we read back the winner.
 */
export async function importJob(
  normalized: NormalizedJob,
  opts: { ownerUserId?: string | null; userId: string },
): Promise<ImportResult> {
  const db = getDb();
  const sourceId = await ensureSourceId(normalized.provenance.adapterKey);
  const descriptionHash = await contentHash(normalized.description);

  const dedupeKey = computeDedupeKey({
    sourceKey: normalized.provenance.adapterKey,
    externalJobId: normalized.externalJobId,
    canonicalUrl: normalized.canonicalUrl,
    company: normalized.company,
    title: normalized.title,
    location: normalized.location.raw ?? normalized.location.city ?? null,
    descriptionHash,
  });

  const existing = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.dedupeKey, dedupeKey)).limit(1);
  if (existing[0]) {
    // Refresh freshness so the UI can show how current the data is.
    await db.update(jobs).set({ fetchedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, existing[0].id));
    return { jobId: existing[0].id, created: false, duplicateOf: dedupeKey };
  }

  const values = {
    sourceId,
    ownerUserId: opts.ownerUserId ?? null,
    externalJobId: normalized.externalJobId,
    canonicalUrl: normalized.canonicalUrl,
    applyUrl: normalized.applyUrl,
    title: sanitizeLabel(normalized.title, 300) || 'Untitled role',
    company: sanitizeLabel(normalized.company, 300) || 'Unknown company',
    companyDomain: normalized.companyDomain,
    description: normalized.description,
    responsibilities: normalized.responsibilities,
    requirements: normalized.requirements,
    preferredQualifications: normalized.preferredQualifications,
    skills: normalized.skills,
    salaryData: normalized.salary,
    locationData: normalized.location,
    workMode: normalized.workMode,
    employmentType: normalized.employmentType,
    seniority: normalized.seniority,
    experienceMinYears: normalized.experienceMinYears,
    experienceMaxYears: normalized.experienceMaxYears,
    industry: normalized.industry,
    visaSponsorship: normalized.visaSponsorship,
    postedAt: normalized.postedAt,
    expiresAt: normalized.expiresAt,
    descriptionHash,
    dedupeKey,
    fetchedAt: normalized.provenance.fetchedAt,
  };

  const inserted = await db
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });

  if (inserted[0]) {
    await recordAudit({
      userId: opts.userId,
      action: 'job.imported',
      entityType: 'job',
      entityId: inserted[0].id,
      afterSummary: `${values.title} at ${values.company}`,
      metadata: {
        adapterKey: normalized.provenance.adapterKey,
        sourceType: normalized.provenance.sourceType,
        hasUrl: Boolean(normalized.canonicalUrl),
        private: Boolean(opts.ownerUserId),
      },
    });
    return { jobId: inserted[0].id, created: true };
  }

  // Lost the race: another request inserted the same dedupe key.
  const winner = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.dedupeKey, dedupeKey)).limit(1);
  if (!winner[0]) throw new Error('Job insert conflicted but no existing row was found.');
  return { jobId: winner[0].id, created: false, duplicateOf: dedupeKey };
}

/** Import a batch, reporting how many were new. */
export async function importJobs(
  normalized: NormalizedJob[],
  opts: { ownerUserId?: string | null; userId: string },
): Promise<{ created: number; duplicates: number; jobIds: string[] }> {
  let created = 0;
  let duplicates = 0;
  const jobIds: string[] = [];

  for (const job of normalized) {
    try {
      const result = await importJob(job, opts);
      jobIds.push(result.jobId);
      if (result.created) created += 1;
      else duplicates += 1;
    } catch (err) {
      console.error('[job-import] skipped one job', err instanceof Error ? err.message : err);
    }
  }

  return { created, duplicates, jobIds };
}

/* ------------------------------------------------------------------ reads -- */

export interface JobWithSource extends Job {
  sourceName: string;
  sourceAdapterKey: string;
  sourceType: JobSourceType;
  sourcePolicyNote: string | null;
  sourceLabel: string;
  saved: boolean;
  hidden: boolean;
}

/** Visible to this user: shared jobs plus their own private imports. */
function visibleTo(userId: string): SQL {
  return or(isNull(jobs.ownerUserId), eq(jobs.ownerUserId, userId))!;
}

export async function getJob(userId: string, jobId: string): Promise<JobWithSource> {
  const rows = await getDb()
    .select({
      job: jobs,
      sourceName: jobSources.name,
      sourceAdapterKey: jobSources.adapterKey,
      sourceType: jobSources.sourceType,
      sourcePolicyNote: jobSources.policyNote,
      savedState: savedJobs.state,
    })
    .from(jobs)
    .innerJoin(jobSources, eq(jobSources.id, jobs.sourceId))
    .leftJoin(savedJobs, and(eq(savedJobs.jobId, jobs.id), eq(savedJobs.userId, userId)))
    .where(and(eq(jobs.id, jobId), visibleTo(userId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError('That job was not found.');

  return decorate(row);
}

function decorate(row: {
  job: Job;
  sourceName: string;
  sourceAdapterKey: string;
  sourceType: string;
  sourcePolicyNote: string | null;
  savedState: string | null;
}): JobWithSource {
  const sourceType = row.sourceType as JobSourceType;
  return {
    ...row.job,
    sourceName: row.sourceName,
    sourceAdapterKey: row.sourceAdapterKey,
    sourceType,
    sourcePolicyNote: row.sourcePolicyNote ?? findSourceDefinition(row.sourceAdapterKey)?.policyNote ?? null,
    sourceLabel: SOURCE_TYPE_LABELS[sourceType] ?? row.sourceName,
    saved: row.savedState === 'saved',
    hidden: row.savedState === 'hidden',
  };
}

export interface JobFilters {
  query?: string;
  titles?: string[];
  skills?: string[];
  seniority?: string[];
  locations?: string[];
  workModes?: string[];
  employmentTypes?: string[];
  companies?: string[];
  sourceTypes?: string[];
  minSalary?: number | null;
  currency?: string | null;
  experienceMax?: number | null;
  visaSponsorship?: string | null;
  industry?: string | null;
  postedWithinDays?: number | null;
  savedOnly?: boolean;
  includeHidden?: boolean;
  limit?: number;
  offset?: number;
}

/** List jobs with filters applied in SQL where possible. */
export async function listJobs(userId: string, filters: JobFilters = {}): Promise<JobWithSource[]> {
  const conditions: SQL[] = [visibleTo(userId)];

  if (filters.query?.trim()) {
    const needle = `%${filters.query.trim()}%`;
    const clause = or(ilike(jobs.title, needle), ilike(jobs.company, needle), ilike(jobs.description, needle));
    if (clause) conditions.push(clause);
  }
  if (filters.titles?.length) {
    const clause = or(...filters.titles.map((t) => ilike(jobs.title, `%${t.trim()}%`)));
    if (clause) conditions.push(clause);
  }
  if (filters.companies?.length) {
    const clause = or(...filters.companies.map((c) => ilike(jobs.company, `%${c.trim()}%`)));
    if (clause) conditions.push(clause);
  }
  if (filters.workModes?.length) conditions.push(inArray(jobs.workMode, filters.workModes));
  if (filters.employmentTypes?.length) conditions.push(inArray(jobs.employmentType, filters.employmentTypes));
  if (filters.seniority?.length) conditions.push(inArray(jobs.seniority, filters.seniority));
  if (filters.visaSponsorship) conditions.push(eq(jobs.visaSponsorship, filters.visaSponsorship));
  if (filters.industry) conditions.push(ilike(jobs.industry, `%${filters.industry}%`));
  if (filters.postedWithinDays) {
    conditions.push(gte(jobs.postedAt, new Date(Date.now() - filters.postedWithinDays * 86_400_000)));
  }
  if (filters.experienceMax !== null && filters.experienceMax !== undefined) {
    // A posting whose minimum exceeds the user's experience is out of reach.
    conditions.push(
      or(isNull(jobs.experienceMinYears), sql`${jobs.experienceMinYears} <= ${filters.experienceMax}`)!,
    );
  }
  if (filters.minSalary) {
    // Keep rows with no stated salary: excluding them would hide most postings.
    conditions.push(
      or(
        sql`${jobs.salaryData}->>'max' IS NULL AND ${jobs.salaryData}->>'min' IS NULL`,
        sql`COALESCE((${jobs.salaryData}->>'max')::numeric, (${jobs.salaryData}->>'min')::numeric) >= ${filters.minSalary}`,
      )!,
    );
  }
  if (filters.locations?.length) {
    const clause = or(
      ...filters.locations.map((l) => sql`${jobs.locationData}->>'raw' ILIKE ${`%${l.trim()}%`}`),
      ...filters.locations.map((l) => sql`${jobs.locationData}->>'city' ILIKE ${`%${l.trim()}%`}`),
    );
    if (clause) conditions.push(clause);
  }
  if (filters.skills?.length) {
    // jsonb array containment, so the index on the column can be used.
    const clause = or(...filters.skills.map((s) => sql`${jobs.skills}::jsonb @> ${JSON.stringify([s])}::jsonb`));
    if (clause) conditions.push(clause);
  }

  const db = getDb();
  const rows = await db
    .select({
      job: jobs,
      sourceName: jobSources.name,
      sourceAdapterKey: jobSources.adapterKey,
      sourceType: jobSources.sourceType,
      sourcePolicyNote: jobSources.policyNote,
      savedState: savedJobs.state,
    })
    .from(jobs)
    .innerJoin(jobSources, eq(jobSources.id, jobs.sourceId))
    .leftJoin(savedJobs, and(eq(savedJobs.jobId, jobs.id), eq(savedJobs.userId, userId)))
    .where(and(...conditions))
    .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.createdAt})`))
    .limit(Math.min(200, filters.limit ?? 60))
    .offset(filters.offset ?? 0);

  let decorated = rows.map(decorate);

  if (filters.sourceTypes?.length) {
    decorated = decorated.filter((j) => filters.sourceTypes!.includes(j.sourceType));
  }
  if (filters.savedOnly) decorated = decorated.filter((j) => j.saved);
  if (!filters.includeHidden) decorated = decorated.filter((j) => !j.hidden);

  return decorated;
}

export async function countJobs(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(visibleTo(userId));
  return Number(rows[0]?.count ?? 0);
}

/* ----------------------------------------------------------- saved/hidden -- */

export async function setJobState(userId: string, jobId: string, state: 'saved' | 'hidden' | 'none'): Promise<void> {
  // Confirms visibility before writing.
  await getJob(userId, jobId);
  const db = getDb();

  if (state === 'none') {
    await db.delete(savedJobs).where(and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, jobId)));
    return;
  }

  await db
    .insert(savedJobs)
    .values({ userId, jobId, state })
    .onConflictDoUpdate({ target: [savedJobs.userId, savedJobs.jobId], set: { state } });
}

/** Delete a job the user imported privately. Shared jobs are never deleted. */
export async function deletePrivateJob(userId: string, jobId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ ownerUserId: jobs.ownerUserId, title: jobs.title })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  const row = rows[0];
  if (!row || row.ownerUserId !== userId) {
    throw new NotFoundError('That job was not found, or is not one of your private imports.');
  }

  await db.delete(jobs).where(and(eq(jobs.id, jobId), eq(jobs.ownerUserId, userId)));
  await recordAudit({
    userId,
    action: 'job.imported',
    entityType: 'job',
    entityId: jobId,
    beforeSummary: `Deleted private import: ${row.title}`,
  });
}

/** Distinct companies across visible jobs, for the filter UI. */
export async function listJobCompanies(userId: string): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ company: jobs.company })
    .from(jobs)
    .where(visibleTo(userId))
    .orderBy(jobs.company)
    .limit(200);
  return rows.map((r) => r.company);
}
