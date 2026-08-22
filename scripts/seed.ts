/**
 * Seed the database with the job-source registry and, optionally, a demo
 * account for local development.
 *
 *   npm run db:seed              registry only (safe for any environment)
 *   npm run db:seed -- --demo    registry + a demo user with a sample job
 *
 * Idempotent: re-running updates rather than duplicating.
 */
import { loadEnv } from './load-env';

loadEnv();

import { eq } from 'drizzle-orm';
import {
  closeDb,
  databaseDriverId,
  getDb,
  jobSources,
  jobs,
  profiles,
  users,
} from '../src/lib/db';
import { JOB_SOURCE_REGISTRY } from '../src/lib/jobs/registry';
import { hashPassword } from '../src/lib/auth/password';
import { computeDedupeKey } from '../src/lib/jobs/dedupe';
import { contentHash } from '../src/lib/security';

const DEMO_EMAIL = 'demo@careerpilot360.local';
const DEMO_PASSWORD = 'CareerPilot360!demo';

async function seedSources() {
  const db = getDb();
  let created = 0;
  let updated = 0;

  for (const src of JOB_SOURCE_REGISTRY) {
    const existing = await db
      .select({ id: jobSources.id })
      .from(jobSources)
      .where(eq(jobSources.adapterKey, src.adapterKey))
      .limit(1);

    if (existing[0]) {
      await db
        .update(jobSources)
        .set({
          name: src.name,
          sourceType: src.sourceType,
          policyStatus: src.policyStatus,
          policyNote: src.policyNote,
          enabled: src.enabledByDefault,
        })
        .where(eq(jobSources.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(jobSources).values({
        name: src.name,
        adapterKey: src.adapterKey,
        sourceType: src.sourceType,
        policyStatus: src.policyStatus,
        policyNote: src.policyNote,
        enabled: src.enabledByDefault,
      });
      created += 1;
    }
  }
  console.info(`[seed] job sources: ${created} created, ${updated} updated`);
}

async function seedDemoUser() {
  const db = getDb();

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  let userId = existing[0]?.id;

  if (!userId) {
    const inserted = await db
      .insert(users)
      .values({
        email: DEMO_EMAIL,
        name: 'Demo Candidate',
        passwordHash: await hashPassword(DEMO_PASSWORD),
        emailVerifiedAt: new Date(),
        onboardingCompletedAt: new Date(),
      })
      .returning({ id: users.id });
    userId = inserted[0]!.id;
    console.info('[seed] demo user created');
  } else {
    console.info('[seed] demo user already present');
  }

  const profileRow = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const profileData = {
    personal: {
      fullName: 'Demo Candidate',
      preferredName: 'Demo',
      email: DEMO_EMAIL,
      phone: '+91 98765 43210',
      country: 'India',
      city: 'Bengaluru',
      timezone: 'Asia/Kolkata',
      photoUrl: '',
    },
    professional: {
      currentTitle: 'Senior Backend Engineer',
      currentCompany: 'Example Systems',
      targetTitles: ['Senior Backend Engineer', 'Staff Engineer', 'Backend Tech Lead'],
      yearsOfExperience: 7,
      careerLevel: 'senior' as const,
      preferredIndustries: ['SaaS', 'Fintech'],
      preferredCompanySizes: ['mid_market' as const, 'large' as const],
      preferredEmploymentTypes: ['full_time' as const],
      skills: [
        'TypeScript', 'Node.js', 'PostgreSQL', 'Redis', 'Kafka', 'Docker',
        'Kubernetes', 'AWS', 'REST APIs', 'GraphQL', 'System Design', 'CI/CD',
      ],
      certifications: [{ name: 'AWS Solutions Architect Associate', issuer: 'Amazon Web Services', year: '2023', credentialId: '' }],
      education: [
        { degree: 'B.E.', field: 'Computer Science', institution: 'Anna University', startYear: '2015', endYear: '2019', grade: '8.4 CGPA' },
      ],
      portfolioUrl: '',
      githubUrl: 'https://github.com/example',
      linkedinUrl: 'https://www.linkedin.com/in/example',
      websiteUrl: '',
      professionalSummary:
        'Backend engineer with seven years building transactional services on Node.js and PostgreSQL. ' +
        'Comfortable owning a service end to end, from schema design to on-call.',
    },
    jobPreferences: {
      preferredRoles: ['Senior Backend Engineer', 'Staff Engineer'],
      preferredLocations: ['Bengaluru', 'Remote (India)'],
      workMode: 'hybrid' as const,
      willingToRelocate: false,
      currency: 'INR' as const,
      currentCtc: 3_200_000,
      minExpectedCtc: 4_000_000,
      maxExpectedCtc: 5_000_000,
      noticePeriodDays: 60,
      availabilityDate: '',
      workAuthorization: 'citizen' as const,
      needsVisaSponsorship: false,
      employmentTypes: ['full_time' as const],
      preferredCompanies: [],
      excludedCompanies: [],
      preferredIndustries: ['SaaS', 'Fintech'],
      minMatchScore: 60,
      maxApplicationsPerDay: 5,
      applicationSchedule: 'daily' as const,
      customKeywords: ['distributed systems', 'payments'],
      excludedKeywords: ['unpaid'],
    },
    applicationProfile: {
      addressLine1: '',
      addressLine2: '',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '',
      country: 'India',
      dateOfBirth: '',
      pronouns: '',
      diversityInfo: '',
      noticePeriodExplanation: 'I am on a 60-day notice period and can potentially negotiate a shorter exit.',
      salaryExplanation: 'Open to discussing the full package rather than base alone.',
      relocationExplanation: '',
      whyThisCompanyTemplate: '',
      customAnswers: [
        {
          question: 'Why are you looking for a new role?',
          answer:
            'I want deeper ownership of a payments-critical service and a team where design review is the norm.',
          allowReuse: true,
        },
      ],
      allowSensitiveAnswerReuse: false,
    },
  };

  if (profileRow[0]) {
    await db.update(profiles).set({ ...profileData, updatedAt: new Date() }).where(eq(profiles.userId, userId));
  } else {
    await db.insert(profiles).values({ userId, ...profileData });
  }

  // A sample manually-entered job, so matching can be exercised immediately.
  const manualSource = await db
    .select({ id: jobSources.id })
    .from(jobSources)
    .where(eq(jobSources.adapterKey, 'manual'))
    .limit(1);

  if (manualSource[0]) {
    const description = [
      'We are hiring a Senior Backend Engineer to own our payments ledger service.',
      '',
      'Responsibilities:',
      '- Design and operate high-throughput transactional services',
      '- Own PostgreSQL schema design and query performance',
      '- Partner with product on API contracts',
      '- Participate in an on-call rotation',
      '',
      'Requirements:',
      '- 5+ years building backend services in TypeScript or Go',
      '- Strong PostgreSQL and relational modelling experience',
      '- Experience with event streaming (Kafka or similar)',
      '- Kubernetes in production',
      '',
      'Preferred:',
      '- Payments or fintech domain exposure',
      '- Terraform',
    ].join('\n');

    const descHash = await contentHash(description);
    const dedupeKey = computeDedupeKey({
      sourceKey: 'manual',
      externalJobId: 'demo-ledger-1',
      canonicalUrl: null,
      company: 'Northwind Payments',
      title: 'Senior Backend Engineer',
      location: 'Bengaluru',
      descriptionHash: descHash,
    });

    const existingJob = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.dedupeKey, dedupeKey)).limit(1);
    if (!existingJob[0]) {
      await db.insert(jobs).values({
        sourceId: manualSource[0].id,
        ownerUserId: userId,
        externalJobId: 'demo-ledger-1',
        title: 'Senior Backend Engineer',
        company: 'Northwind Payments',
        description,
        responsibilities: [
          'Design and operate high-throughput transactional services',
          'Own PostgreSQL schema design and query performance',
          'Partner with product on API contracts',
          'Participate in an on-call rotation',
        ],
        requirements: [
          '5+ years building backend services in TypeScript or Go',
          'Strong PostgreSQL and relational modelling experience',
          'Experience with event streaming (Kafka or similar)',
          'Kubernetes in production',
        ],
        preferredQualifications: ['Payments or fintech domain exposure', 'Terraform'],
        skills: ['TypeScript', 'Go', 'PostgreSQL', 'Kafka', 'Kubernetes', 'Terraform'],
        salaryData: { min: 3_500_000, max: 5_500_000, currency: 'INR', period: 'year' },
        locationData: { city: 'Bengaluru', country: 'India', raw: 'Bengaluru, India' },
        workMode: 'hybrid',
        employmentType: 'full_time',
        seniority: 'senior',
        experienceMinYears: 5,
        experienceMaxYears: 9,
        industry: 'Fintech',
        visaSponsorship: 'unknown',
        postedAt: new Date(),
        descriptionHash: descHash,
        dedupeKey,
      });
      console.info('[seed] sample job created');
    }
  }

  console.info('');
  console.info('  Demo sign-in');
  console.info(`    email:    ${DEMO_EMAIL}`);
  console.info(`    password: ${DEMO_PASSWORD}`);
  console.info('');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.local first.');
    process.exit(1);
  }
  console.info(`[seed] driver=${databaseDriverId()}`);

  await seedSources();

  if (process.argv.includes('--demo')) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[seed] refusing to create a demo account with NODE_ENV=production.');
      process.exit(1);
    }
    await seedDemoUser();
  } else {
    console.info('[seed] pass --demo to also create a local demo account');
  }

  await closeDb();
}

main().catch((err) => {
  console.error('[seed] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
