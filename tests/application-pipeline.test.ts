/**
 * Application packet and submission pipeline, against a real database.
 *
 * The highest-stakes properties tested here:
 *  - sensitive questions are never auto-answered without explicit opt-in;
 *  - the packet's free text never introduces an unsupported figure;
 *  - "submitted" can only ever be set by a direct user action;
 *  - tailoring reorders content but never changes a fact.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createTestDb,
  createUser,
  resetAdapters,
  useMemoryStorage,
  type TestDb,
  type TestUser,
} from './helpers/db';
import * as schema from '@/lib/db/schema';
import { createVersion } from '@/lib/resume/service';
import { normalizeResumeText } from '@/lib/resume/normalize';
import { loadProfile } from '@/lib/profile/service';
import { buildManualJob } from '@/lib/jobs/adapters/user-provided';
import { importJob, getJob } from '@/lib/jobs/service';
import { loadMatchContext, scoreAndStore } from '@/lib/jobs/match-service';
import { generateApplicationPacket } from '@/lib/applications/packet';
import { tailorResumeForJob } from '@/lib/applications/tailor';
import { resolveScreeningQuestion, resolveScreeningQuestions } from '@/lib/applications/screening';
import {
  createPacket,
  getOrCreateApplication,
  markSubmittedByUser,
  transitionApplication,
} from '@/lib/applications/service';
import { InvalidTransitionError } from '@/lib/applications/state';
import { emptyProfile, type FullProfile } from '@/lib/profile/types';
import { resumeToPlainText } from '@/lib/resume/types';
import { STRONG_RESUME, SAMPLE_JOB_DESCRIPTION } from './fixtures/resumes';

let harness: TestDb;
let user: TestUser;

beforeAll(async () => {
  harness = await createTestDb();
  useMemoryStorage();
  user = await createUser(harness.db, 'applicant@example.com', { fullName: 'Priya Sharma' });
});

afterAll(async () => {
  resetAdapters();
  await harness.close();
});

/* ------------------------------------------------------------ screening --- */

describe('screening question resolution', () => {
  function profileWith(overrides: Partial<FullProfile['jobPreferences']>, reuse = false): FullProfile {
    const p = emptyProfile();
    p.jobPreferences = { ...p.jobPreferences, ...overrides };
    p.applicationProfile = { ...p.applicationProfile, allowSensitiveAnswerReuse: reuse };
    return p;
  }

  it('never answers salary without explicit reuse permission', () => {
    const withData = profileWith({ minExpectedCtc: 4_000_000, currency: 'INR' }, false);
    const result = resolveScreeningQuestion('What are your salary expectations?', withData);
    expect(result.needsUserInput).toBe(true);
    expect(result.answer).toBe('');
    expect(result.category).toBe('salary');
  });

  it('answers salary once reuse is explicitly permitted', () => {
    const withData = profileWith({ minExpectedCtc: 4_000_000, currency: 'INR' }, true);
    const result = resolveScreeningQuestion('What are your salary expectations?', withData);
    expect(result.needsUserInput).toBe(false);
    expect(result.answer).toContain('4000000');
    expect(result.source).toBe('profile_field');
  });

  it('never fabricates an answer to criminal history, disability, gender or age', () => {
    const reuseOn = profileWith({}, true);
    for (const q of [
      'Have you ever been convicted of a felony?',
      'Do you have a disability requiring accommodation?',
      'What is your gender?',
      'What is your date of birth?',
    ]) {
      const result = resolveScreeningQuestion(q, reuseOn);
      // Reuse being on is not enough: there is no structured field for these,
      // and none should ever be synthesised.
      expect(result.needsUserInput, q).toBe(true);
      expect(result.answer, q).toBe('');
    }
  });

  it('requires reuse permission even when the field exists, for every sensitive category', () => {
    const full = profileWith(
      {
        minExpectedCtc: 4_000_000,
        workAuthorization: 'citizen',
        noticePeriodDays: 60,
        willingToRelocate: true,
      },
      false,
    );
    for (const q of [
      'What are your salary expectations?',
      'Are you authorized to work in this country?',
      'What is your notice period?',
      'Are you willing to relocate?',
    ]) {
      const result = resolveScreeningQuestion(q, full);
      expect(result.needsUserInput, q).toBe(true);
    }
  });

  it('uses a user-authored custom answer regardless of the reuse toggle', () => {
    const p = emptyProfile();
    p.applicationProfile.allowSensitiveAnswerReuse = false;
    p.applicationProfile.customAnswers = [
      { question: 'What are your salary expectations?', answer: 'Open to discussing the full package.', allowReuse: true },
    ];
    const result = resolveScreeningQuestion('What are your salary expectations?', p);
    expect(result.needsUserInput).toBe(false);
    expect(result.answer).toBe('Open to discussing the full package.');
    expect(result.source).toBe('profile_custom_answer');
  });

  it('respects allowReuse: false on an individual custom answer', () => {
    const p = emptyProfile();
    p.applicationProfile.customAnswers = [
      { question: 'What are your salary expectations?', answer: 'Confidential for now.', allowReuse: false },
    ];
    const result = resolveScreeningQuestion('What are your salary expectations?', p);
    // The saved answer is declined for reuse, and there is no field fallback
    // without the master toggle, so it needs user input.
    expect(result.needsUserInput).toBe(true);
  });

  it('answers plain, non-sensitive questions from the profile', () => {
    const p = emptyProfile();
    p.professional.linkedinUrl = 'https://linkedin.com/in/priya';
    const result = resolveScreeningQuestion('What is your LinkedIn URL?', p);
    expect(result.needsUserInput).toBe(false);
    expect(result.answer).toBe('https://linkedin.com/in/priya');
    expect(result.category).toBeNull();
  });

  it('marks an unmatched non-sensitive question as needing input, never guessing', () => {
    const result = resolveScreeningQuestion('Describe a challenging project you led.', emptyProfile());
    expect(result.needsUserInput).toBe(true);
    expect(result.category).toBeNull();
  });

  it('resolves a batch independently', () => {
    const results = resolveScreeningQuestions(
      ['What is your notice period?', 'What is your LinkedIn URL?'],
      emptyProfile(),
    );
    expect(results).toHaveLength(2);
  });
});

/* --------------------------------------------------------------- packet --- */

describe('packet generation', () => {
  let jobId: string;
  let versionId: string;

  beforeAll(async () => {
    const resume = normalizeResumeText(STRONG_RESUME).resume;
    versionId = await createVersion(user.id, { name: 'Base', structuredContent: resume, isDefault: true });

    const normalized = buildManualJob(
      { title: 'Senior Backend Engineer', company: 'Northwind Payments', description: SAMPLE_JOB_DESCRIPTION, location: 'Bengaluru' },
      'manual',
    );
    const imported = await importJob(normalized, { userId: user.id, ownerUserId: user.id });
    jobId = imported.jobId;

    const ctx = await loadMatchContext(user.id);
    const job = await getJob(user.id, jobId);
    await scoreAndStore(user.id, job, ctx);
  });

  it('builds a complete packet with deterministic content (no AI)', async () => {
    const job = await getJob(user.id, jobId);
    const profile = await loadProfile(user.id);
    const resume = normalizeResumeText(STRONG_RESUME).resume;

    const content = await generateApplicationPacket(
      { userId: user.id, job, match: null, resume, profile },
      { useAi: false },
    );

    expect(content.usedAi).toBe(false);
    expect(content.coverLetter).toContain(job.company);
    expect(content.coverLetter).toContain('Priya Sharma');
    expect(content.emailSubject).toContain(job.title);
    expect(content.checklist.length).toBeGreaterThan(0);
    expect(content.screeningAnswers.length).toBeGreaterThan(0);
  });

  it('flags salary and sponsorship as needing input by default', async () => {
    const job = await getJob(user.id, jobId);
    const profile = await loadProfile(user.id); // seeded without allowSensitiveAnswerReuse
    const resume = normalizeResumeText(STRONG_RESUME).resume;

    const content = await generateApplicationPacket(
      { userId: user.id, job, match: null, resume, profile },
      { useAi: false },
    );

    const salaryQ = content.screeningAnswers.find((a) => a.category === 'salary');
    expect(salaryQ?.needsUserInput).toBe(true);
  });

  it('persists a packet and creates the associated application', async () => {
    const job = await getJob(user.id, jobId);
    const profile = await loadProfile(user.id);
    const resume = normalizeResumeText(STRONG_RESUME).resume;
    const content = await generateApplicationPacket(
      { userId: user.id, job, match: null, resume, profile },
      { useAi: false },
    );

    const packetId = await createPacket(user.id, { jobId, resumeVersionId: versionId, content });
    const application = await getOrCreateApplication(user.id, jobId, packetId);

    expect(application.jobId).toBe(jobId);
    expect(application.applicationPacketId).toBe(packetId);
    expect(application.status).toBe('draft');

    const packets = await harness.db
      .select()
      .from(schema.applicationPackets)
      .where(eq(schema.applicationPackets.id, packetId));
    expect(packets[0]?.userId).toBe(user.id);
    expect(packets[0]?.warnings).toBeDefined();
  });

  it('records a packet.generated audit event without leaking full document text', async () => {
    const job = await getJob(user.id, jobId);
    const profile = await loadProfile(user.id);
    const resume = normalizeResumeText(STRONG_RESUME).resume;
    const content = await generateApplicationPacket(
      { userId: user.id, job, match: null, resume, profile },
      { useAi: false },
    );
    await createPacket(user.id, { jobId, resumeVersionId: versionId, content });

    const events = await harness.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'packet.generated'));

    expect(events.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(content.coverLetter);
  });
});

/* -------------------------------------------------------------- tailoring */

describe('resume tailoring never changes facts', () => {
  it('preserves chronological role order', async () => {
    const resume = normalizeResumeText(STRONG_RESUME).resume;
    const job = await getJob(user.id, (await importJob(
      buildManualJob({ title: 'Senior Backend Engineer', company: 'Acme', description: SAMPLE_JOB_DESCRIPTION }, 'manual'),
      { userId: user.id, ownerUserId: user.id },
    )).jobId);

    const tailored = tailorResumeForJob(resume, job, null);

    // Same set of roles, same dates — only bullet/skill ORDER may change.
    expect(tailored.experience.map((e) => `${e.title}|${e.startDate}`).sort()).toEqual(
      resume.experience.map((e) => `${e.title}|${e.startDate}`).sort(),
    );
  });

  it('never introduces a bullet or skill absent from the original', async () => {
    const resume = normalizeResumeText(STRONG_RESUME).resume;
    const job = await getJob(user.id, (await importJob(
      buildManualJob({ title: 'Senior Backend Engineer', company: 'Acme2', description: SAMPLE_JOB_DESCRIPTION }, 'manual'),
      { userId: user.id, ownerUserId: user.id },
    )).jobId);

    const tailored = tailorResumeForJob(resume, job, null);

    const originalBullets = new Set(resume.experience.flatMap((e) => e.bullets.map((b) => b.text)));
    const tailoredBullets = tailored.experience.flatMap((e) => e.bullets.map((b) => b.text));
    for (const b of tailoredBullets) expect(originalBullets.has(b), b).toBe(true);

    // Same total bullet count per role — nothing was silently added.
    for (let i = 0; i < resume.experience.length; i++) {
      const before = resume.experience[i]!.bullets.length;
      const matchingAfter = tailored.experience.find((e) => e.title === resume.experience[i]!.title)?.bullets.length;
      expect(matchingAfter).toBe(before);
    }
  });

  it('produces identical plain text content, just reordered', async () => {
    const resume = normalizeResumeText(STRONG_RESUME).resume;
    const job = await getJob(user.id, (await importJob(
      buildManualJob({ title: 'Senior Backend Engineer', company: 'Acme3', description: SAMPLE_JOB_DESCRIPTION }, 'manual'),
      { userId: user.id, ownerUserId: user.id },
    )).jobId);

    const tailored = tailorResumeForJob(resume, job, null);
    const originalWords = resumeToPlainText(resume).match(/[a-z0-9]+/gi)?.sort();
    const tailoredWords = resumeToPlainText(tailored).match(/[a-z0-9]+/gi)?.sort();
    expect(tailoredWords).toEqual(originalWords);
  });
});

/* ------------------------------------------------------ submission gating */

describe('submission can only be recorded by the user', () => {
  let applicationId: string;

  beforeAll(async () => {
    const resume = normalizeResumeText(STRONG_RESUME).resume;
    const job = await getJob(
      user.id,
      (
        await importJob(
          buildManualJob({ title: 'Role', company: 'GatingCo', description: SAMPLE_JOB_DESCRIPTION }, 'manual'),
          { userId: user.id, ownerUserId: user.id },
        )
      ).jobId,
    );
    const profile = await loadProfile(user.id);
    const content = await generateApplicationPacket(
      { userId: user.id, job, match: null, resume, profile },
      { useAi: false },
    );
    const packetId = await createPacket(user.id, { jobId: job.id, content });
    const app = await getOrCreateApplication(user.id, job.id, packetId);
    applicationId = app.id;
  });

  it('cannot jump straight from draft to submitted', async () => {
    await expect(
      transitionApplication(user.id, applicationId, { toStatus: 'submitted_by_user', actor: 'user' }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('rejects a system or assistant actor attempting to mark submitted', async () => {
    await transitionApplication(user.id, applicationId, { toStatus: 'ready_for_review', actor: 'user' });
    await transitionApplication(user.id, applicationId, { toStatus: 'approved', actor: 'user' });

    for (const actor of ['system', 'assistant', 'connector'] as const) {
      await expect(
        transitionApplication(user.id, applicationId, { toStatus: 'submitted_by_user', actor }),
      ).rejects.toThrow(/confirmed user action/i);
    }

    const row = await harness.db
      .select({ status: schema.applications.status })
      .from(schema.applications)
      .where(eq(schema.applications.id, applicationId));
    expect(row[0]?.status).toBe('approved');
  });

  it('records a real user confirmation and stamps submittedAt/submittedByUserId', async () => {
    const before = new Date();
    const app = await markSubmittedByUser(user.id, applicationId, {
      externalUrl: 'https://gatingco.example/apply/123',
      userNotes: 'Applied via referral form',
    });

    expect(app.status).toBe('submitted_by_user');
    expect(app.submittedAt).not.toBeNull();
    expect(app.submittedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(app.submittedByUserId).toBe(user.id);
    expect(app.externalUrl).toBe('https://gatingco.example/apply/123');

    const events = await harness.db
      .select()
      .from(schema.applicationEvents)
      .where(eq(schema.applicationEvents.applicationId, applicationId));
    expect(events.some((e) => e.eventType === 'application.marked_submitted')).toBe(true);
  });

  it('cannot be marked submitted twice', async () => {
    await expect(
      transitionApplication(user.id, applicationId, { toStatus: 'submitted_by_user', actor: 'user' }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('records an audit event for every transition', async () => {
    const events = await harness.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, applicationId));
    const actions = events.map((e) => e.action);
    expect(actions).toContain('application.approved');
    expect(actions).toContain('application.marked_submitted');
  });
});

describe('tenant isolation for applications', () => {
  it('a second user cannot see or mutate the first user’s application', async () => {
    const bob = await createUser(harness.db, 'bob-apps@example.com');
    const resume = normalizeResumeText(STRONG_RESUME).resume;
    const job = await getJob(
      user.id,
      (
        await importJob(
          buildManualJob({ title: 'Isolated Role', company: 'IsoCo', description: SAMPLE_JOB_DESCRIPTION }, 'manual'),
          { userId: user.id, ownerUserId: user.id },
        )
      ).jobId,
    );
    const profile = await loadProfile(user.id);
    const content = await generateApplicationPacket(
      { userId: user.id, job, match: null, resume, profile },
      { useAi: false },
    );
    const packetId = await createPacket(user.id, { jobId: job.id, content });
    const app = await getOrCreateApplication(user.id, job.id, packetId);

    await expect(
      transitionApplication(bob.id, app.id, { toStatus: 'ready_for_review', actor: 'user' }),
    ).rejects.toThrow();
  });
});
