/**
 * CareerPilot360 database schema (Drizzle / PostgreSQL).
 *
 * Tenant isolation contract:
 *  - Every user-owned table carries `user_id NOT NULL` with `ON DELETE CASCADE`.
 *  - Every such table has an index leading with `user_id`.
 *  - Application code must never query these tables without a `user_id`
 *    predicate; `src/lib/db/tenant.ts` provides the only sanctioned helpers.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/* ============================================================== identity == */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    name: text('name'),
    image: text('image'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    retentionDays: integer('retention_days'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email), index('users_deleted_at_idx').on(t.deletedAt)],
);

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    /** Only stored when a connector genuinely needs to call the provider later. */
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    tokenType: text('token_type'),
    scopes: text('scopes'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('oauth_provider_account_unique').on(t.provider, t.providerAccountId),
    index('oauth_accounts_user_idx').on(t.userId),
  ],
);

/** Short-lived tokens for email verification and password reset (hashed at rest). */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(), // 'email_verification' | 'password_reset'
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('auth_tokens_hash_unique').on(t.tokenHash),
    index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose),
  ],
);

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    consentType: text('consent_type').notNull(),
    version: text('version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('consents_user_type_idx').on(t.userId, t.consentType)],
);

/* =============================================================== profile == */

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Personal block - see `ProfilePersonal` in src/lib/profile/types.ts */
    personal: jsonb('personal').notNull().default({}),
    /** Professional block - titles, skills, education, certifications, links */
    professional: jsonb('professional').notNull().default({}),
    /** Job preferences - roles, locations, CTC, notice period, limits */
    jobPreferences: jsonb('job_preferences').notNull().default({}),
    /** Application answers - address, reusable answers, custom Q&A */
    applicationProfile: jsonb('application_profile').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('profiles_user_unique').on(t.userId)],
);

/* ================================================================ resume == */

export const resumeDocuments = pgTable(
  'resume_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    /** Immutable pointer to the original upload. Never overwritten. */
    blobPath: text('blob_path').notNull(),
    blobUrl: text('blob_url'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    contentHash: text('content_hash').notNull(),
    extractedText: text('extracted_text'),
    /** 'pending' | 'parsed' | 'failed' | 'needs_review' */
    parsingStatus: text('parsing_status').notNull().default('pending'),
    parsingError: text('parsing_error'),
    parsingMeta: jsonb('parsing_meta').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('resume_documents_user_idx').on(t.userId, t.createdAt),
    index('resume_documents_hash_idx').on(t.userId, t.contentHash),
  ],
);

export const resumeVersions = pgTable(
  'resume_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceResumeId: uuid('source_resume_id').references(() => resumeDocuments.id, { onDelete: 'set null' }),
    parentVersionId: uuid('parent_version_id'),
    /** Set when this version was tailored for a specific job. */
    jobId: uuid('job_id'),
    name: text('name').notNull(),
    /** Canonical structured resume - see `StructuredResume` */
    structuredContent: jsonb('structured_content').notNull().default({}),
    plainText: text('plain_text').notNull().default(''),
    pdfBlobPath: text('pdf_blob_path'),
    pdfBlobUrl: text('pdf_blob_url'),
    template: text('template').notNull().default('modern'),
    templateOptions: jsonb('template_options').notNull().default({}),
    isDefault: boolean('is_default').notNull().default(false),
    isTailored: boolean('is_tailored').notNull().default(false),
    contentHash: text('content_hash'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('resume_versions_user_idx').on(t.userId, t.createdAt),
    index('resume_versions_parent_idx').on(t.parentVersionId),
    index('resume_versions_job_idx').on(t.userId, t.jobId),
  ],
);

export const resumeAnalyses = pgTable(
  'resume_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resumeVersionId: uuid('resume_version_id')
      .notNull()
      .references(() => resumeVersions.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id'),
    overallScore: integer('overall_score').notNull(),
    /** Full `AtsReport` payload: section scores, findings, keywords. */
    report: jsonb('report').notNull().default({}),
    /** 'heuristic' | 'heuristic+ai' */
    mode: text('mode').notNull().default('heuristic'),
    provider: text('provider'),
    model: text('model'),
    createdAt: createdAt(),
  },
  (t) => [index('resume_analyses_user_version_idx').on(t.userId, t.resumeVersionId, t.createdAt)],
);

export const resumeSuggestions = pgTable(
  'resume_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resumeVersionId: uuid('resume_version_id')
      .notNull()
      .references(() => resumeVersions.id, { onDelete: 'cascade' }),
    analysisId: uuid('analysis_id').references(() => resumeAnalyses.id, { onDelete: 'set null' }),
    category: text('category').notNull(),
    priority: text('priority').notNull(), // 'high' | 'medium' | 'low'
    sectionPath: text('section_path'),
    originalText: text('original_text').notNull().default(''),
    suggestedText: text('suggested_text').notNull().default(''),
    reason: text('reason').notNull().default(''),
    /** Which source section supports this change - never invented. */
    evidence: jsonb('evidence').notNull().default({}),
    safeToAutoApply: boolean('safe_to_auto_apply').notNull().default(false),
    /** 'pending' | 'accepted' | 'rejected' | 'edited' | 'applied' */
    status: text('status').notNull().default('pending'),
    userEditedText: text('user_edited_text'),
    appliedToVersionId: uuid('applied_to_version_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('resume_suggestions_user_version_idx').on(t.userId, t.resumeVersionId),
    index('resume_suggestions_status_idx').on(t.userId, t.status),
  ],
);

export const generatedDocuments = pgTable(
  'generated_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resumeVersionId: uuid('resume_version_id').references(() => resumeVersions.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id'),
    kind: text('kind').notNull().default('resume_pdf'),
    template: text('template').notNull(),
    blobPath: text('blob_path').notNull(),
    blobUrl: text('blob_url'),
    contentHash: text('content_hash').notNull(),
    provider: text('provider'),
    model: text('model'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('generated_documents_user_idx').on(t.userId, t.generatedAt)],
);

/* ================================================================== jobs == */

export const jobSources = pgTable(
  'job_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    adapterKey: text('adapter_key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** 'authorized_api' | 'public_feed' | 'public_board' | 'user_provided' | 'manual' | 'external_link' */
    sourceType: text('source_type').notNull(),
    /** Human-readable compliance note shown in the UI. */
    policyStatus: text('policy_status').notNull().default('allowed'),
    policyNote: text('policy_note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('job_sources_adapter_key_unique').on(t.adapterKey)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => jobSources.id, { onDelete: 'restrict' }),
    /** Null for shared/public jobs; set for user-imported private listings. */
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    externalJobId: text('external_job_id'),
    canonicalUrl: text('canonical_url'),
    applyUrl: text('apply_url'),
    title: text('title').notNull(),
    company: text('company').notNull(),
    companyDomain: text('company_domain'),
    description: text('description').notNull().default(''),
    responsibilities: jsonb('responsibilities').notNull().default([]),
    requirements: jsonb('requirements').notNull().default([]),
    preferredQualifications: jsonb('preferred_qualifications').notNull().default([]),
    skills: jsonb('skills').notNull().default([]),
    salaryData: jsonb('salary_data').notNull().default({}),
    locationData: jsonb('location_data').notNull().default({}),
    workMode: text('work_mode'), // 'remote' | 'hybrid' | 'onsite' | 'unknown'
    employmentType: text('employment_type'),
    seniority: text('seniority'),
    experienceMinYears: integer('experience_min_years'),
    experienceMaxYears: integer('experience_max_years'),
    industry: text('industry'),
    visaSponsorship: text('visa_sponsorship'), // 'yes' | 'no' | 'unknown'
    postedAt: timestamp('posted_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    descriptionHash: text('description_hash').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    /** Freshness: when the source was last read. */
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('jobs_dedupe_key_unique').on(t.dedupeKey),
    index('jobs_source_external_idx').on(t.sourceId, t.externalJobId),
    index('jobs_company_title_idx').on(t.company, t.title),
    index('jobs_owner_idx').on(t.ownerUserId, t.createdAt),
    index('jobs_posted_idx').on(t.postedAt),
  ],
);

export const jobSearches = pgTable(
  'job_searches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    query: text('query').notNull().default(''),
    filters: jsonb('filters').notNull().default({}),
    resultCount: integer('result_count').notNull().default(0),
    sourcesUsed: jsonb('sources_used').notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index('job_searches_user_idx').on(t.userId, t.createdAt)],
);

export const savedJobs = pgTable(
  'saved_jobs',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    /** 'saved' | 'hidden' */
    state: text('state').notNull().default('saved'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.jobId] })],
);

export const jobMatches = pgTable(
  'job_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    resumeVersionId: uuid('resume_version_id').references(() => resumeVersions.id, { onDelete: 'set null' }),
    matchScore: integer('match_score').notNull(),
    scoreBreakdown: jsonb('score_breakdown').notNull().default({}),
    missingRequirements: jsonb('missing_requirements').notNull().default([]),
    transferableSkills: jsonb('transferable_skills').notNull().default([]),
    concerns: jsonb('concerns').notNull().default([]),
    explanation: text('explanation').notNull().default(''),
    recommendedResumeVersionId: uuid('recommended_resume_version_id'),
    /** 'deterministic' | 'deterministic+ai' */
    mode: text('mode').notNull().default('deterministic'),
    provider: text('provider'),
    model: text('model'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('job_matches_user_job_unique').on(t.userId, t.jobId),
    index('job_matches_user_score_idx').on(t.userId, t.matchScore),
  ],
);

/* ========================================================= applications == */

export const applicationPackets = pgTable(
  'application_packets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    resumeVersionId: uuid('resume_version_id').references(() => resumeVersions.id, { onDelete: 'set null' }),
    tailoredResumeVersionId: uuid('tailored_resume_version_id').references(() => resumeVersions.id, {
      onDelete: 'set null',
    }),
    coverLetter: text('cover_letter').notNull().default(''),
    shortSummary: text('short_summary').notNull().default(''),
    emailSubject: text('email_subject').notNull().default(''),
    recruiterEmail: text('recruiter_email').notNull().default(''),
    linkedinMessage: text('linkedin_message').notNull().default(''),
    screeningAnswers: jsonb('screening_answers').notNull().default([]),
    keySkills: jsonb('key_skills').notNull().default([]),
    checklist: jsonb('checklist').notNull().default([]),
    warnings: jsonb('warnings').notNull().default([]),
    diff: jsonb('diff').notNull().default({}),
    /** 'draft' | 'ready_for_review' | 'approved' | 'needs_user_input' */
    status: text('status').notNull().default('draft'),
    provider: text('provider'),
    model: text('model'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('application_packets_user_job_idx').on(t.userId, t.jobId, t.createdAt)],
);

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    applicationPacketId: uuid('application_packet_id').references(() => applicationPackets.id, {
      onDelete: 'set null',
    }),
    resumeVersionId: uuid('resume_version_id').references(() => resumeVersions.id, { onDelete: 'set null' }),
    /** See `APPLICATION_STATUSES` in src/lib/applications/state.ts */
    status: text('status').notNull().default('draft'),
    /** How it reached the employer: 'manual_external' | 'authorized_connector' | 'email' */
    submissionMethod: text('submission_method'),
    source: text('source'),
    externalUrl: text('external_url'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    userNotes: text('user_notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('applications_user_job_unique').on(t.userId, t.jobId),
    index('applications_user_status_idx').on(t.userId, t.status, t.updatedAt),
  ],
);

export const applicationEvents = pgTable(
  'application_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    metadata: jsonb('metadata').notNull().default({}),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorType: text('actor_type').notNull().default('user'),
    createdAt: createdAt(),
  },
  (t) => [index('application_events_app_idx').on(t.applicationId, t.createdAt)],
);

/* ============================================================== outreach == */

export const outreachContacts = pgTable(
  'outreach_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    title: text('title'),
    company: text('company'),
    email: text('email'),
    linkedinUrl: text('linkedin_url'),
    /** 'user_provided' | 'public_company_page' | 'authorized_api' - never scraped/guessed. */
    source: text('source').notNull().default('user_provided'),
    provenance: text('provenance').notNull().default(''),
    /** 'unverified' | 'user_confirmed' | 'bounced' */
    verificationStatus: text('verification_status').notNull().default('unverified'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('outreach_contacts_user_idx').on(t.userId, t.createdAt),
    index('outreach_contacts_email_idx').on(t.userId, t.email),
  ],
);

export const outreachDrafts = pgTable(
  'outreach_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => outreachContacts.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    channel: text('channel').notNull().default('email'), // 'email' | 'linkedin'
    subject: text('subject').notNull().default(''),
    body: text('body').notNull().default(''),
    followUpBody: text('follow_up_body'),
    /** Draft-and-copy only — see docs/adapters.md. Never sent by this app. */
    linkedinMessage: text('linkedin_message'),
    /** Plain-language window ("weekday mornings"), never a specific date/time. */
    suggestedTiming: text('suggested_timing'),
    suggestedSendAt: timestamp('suggested_send_at', { withTimezone: true }),
    attachmentVersionId: uuid('attachment_version_id').references(() => resumeVersions.id, { onDelete: 'set null' }),
    /** 'draft' | 'approved' | 'sent' | 'failed' | 'cancelled' */
    status: text('status').notNull().default('draft'),
    provider: text('provider'),
    model: text('model'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('outreach_drafts_user_idx').on(t.userId, t.createdAt)],
);

export const outreachSends = pgTable(
  'outreach_sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => outreachDrafts.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    recipient: text('recipient').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    providerMessageId: text('provider_message_id'),
    /** 'pending' | 'sent' | 'failed' */
    status: text('status').notNull().default('pending'),
    errorMessage: text('error_message'),
    /** Guarantees one send per draft even under retry. */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('outreach_sends_idempotency_unique').on(t.idempotencyKey),
    index('outreach_sends_user_idx').on(t.userId, t.createdAt),
    index('outreach_sends_recipient_idx').on(t.userId, t.recipient),
  ],
);

/** Stop-contact list. A recipient here can never be emailed again. */
export const outreachSuppressions = pgTable(
  'outreach_suppressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    reason: text('reason').notNull().default('user_requested'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('outreach_suppressions_unique').on(t.userId, t.email)],
);

/* ============================================================ scheduling == */

export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskType: text('task_type').notNull(),
    /** Simple recurrence: 'daily' | 'weekdays' | 'weekly' | 'hourly' */
    scheduleExpression: text('schedule_expression').notNull(),
    hourOfDay: integer('hour_of_day').notNull().default(9),
    timezone: text('timezone').notNull().default('UTC'),
    enabled: boolean('enabled').notNull().default(true),
    preferences: jsonb('preferences').notNull().default({}),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('schedules_user_idx').on(t.userId),
    index('schedules_due_idx').on(t.enabled, t.nextRunAt),
  ],
);

export const backgroundTasks = pgTable(
  'background_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    taskType: text('task_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    /** 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' */
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    result: jsonb('result').notNull().default({}),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('background_tasks_idempotency_unique').on(t.idempotencyKey),
    index('background_tasks_claim_idx').on(t.status, t.runAfter),
    index('background_tasks_user_idx').on(t.userId, t.createdAt),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    href: text('href'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

/* ==================================================================== AI == */

export const aiProviderKeys = pgTable(
  'ai_provider_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    /** AES-256-GCM envelope. Never returned to the client. */
    encryptedKey: text('encrypted_key').notNull(),
    /** Only the last 4 characters are ever displayed. */
    maskedKey: text('masked_key').notNull(),
    baseUrl: text('base_url'),
    defaultModel: text('default_model'),
    enabled: boolean('enabled').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    /** Per-task provider overrides, cost ceilings, disabled tasks. */
    settings: jsonb('settings').notNull().default({}),
    monthlyTokenLimit: integer('monthly_token_limit'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    validationStatus: text('validation_status').notNull().default('untested'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('ai_provider_keys_user_provider_unique').on(t.userId, t.provider)],
);

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    task: text('task').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    succeeded: boolean('succeeded').notNull().default(true),
    errorCode: text('error_code'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_usage_user_idx').on(t.userId, t.createdAt)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New conversation'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('conversations_user_idx').on(t.userId, t.updatedAt)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant' | 'tool' | 'system'
    content: text('content').notNull().default(''),
    toolName: text('tool_name'),
    toolArguments: jsonb('tool_arguments'),
    toolResult: jsonb('tool_result'),
    /** Set when a mutating tool call is awaiting explicit user confirmation. */
    pendingConfirmation: jsonb('pending_confirmation'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    provider: text('provider'),
    model: text('model'),
    tokenUsage: jsonb('token_usage').notNull().default({}),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

/* ================================================================= audit == */

/**
 * Append-only. There is no update or delete path in application code;
 * `recordAudit()` in src/lib/audit.ts is the only writer.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').notNull().default('user'), // 'user' | 'system' | 'assistant' | 'connector'
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** Summaries only - never raw keys and never full resume content. */
    beforeSummary: text('before_summary'),
    afterSummary: text('after_summary'),
    metadata: jsonb('metadata').notNull().default({}),
    requestId: text('request_id'),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_events_user_idx').on(t.userId, t.createdAt),
    index('audit_events_action_idx').on(t.action, t.createdAt),
    index('audit_events_entity_idx').on(t.entityType, t.entityId),
  ],
);

/** Fixed-window rate limiting. Durable so it survives serverless cold starts. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull().default(0),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rate_limits_window_idx').on(t.windowStart)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type ResumeDocument = typeof resumeDocuments.$inferSelect;
export type ResumeVersion = typeof resumeVersions.$inferSelect;
export type ResumeSuggestion = typeof resumeSuggestions.$inferSelect;
export type ResumeAnalysis = typeof resumeAnalyses.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobSource = typeof jobSources.$inferSelect;
export type JobMatch = typeof jobMatches.$inferSelect;
export type ApplicationPacket = typeof applicationPackets.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type ApplicationEvent = typeof applicationEvents.$inferSelect;
export type OutreachContact = typeof outreachContacts.$inferSelect;
export type OutreachDraft = typeof outreachDrafts.$inferSelect;
export type OutreachSend = typeof outreachSends.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type BackgroundTask = typeof backgroundTasks.$inferSelect;
export type AiProviderKey = typeof aiProviderKeys.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type GeneratedDocument = typeof generatedDocuments.$inferSelect;
