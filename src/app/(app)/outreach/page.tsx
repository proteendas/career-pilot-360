import type { Metadata } from 'next';
import { inArray } from 'drizzle-orm';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { OutreachView } from '@/components/outreach/outreach-view';
import { requireUserPage } from '@/lib/auth';
import { isDatabaseConfigured, getDb, jobs } from '@/lib/db';
import { listContacts, listSuppressions, type ContactSource } from '@/lib/outreach/contacts';
import { listDrafts } from '@/lib/outreach/drafts';
import { aiAvailability } from '@/lib/ai/client';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = { title: 'Outreach' };

export default async function OutreachPage() {
  const user = await requireUserPage('/outreach');

  if (!isDatabaseConfigured()) {
    return (
      <PageShell>
        <PageHeader title="Outreach" />
        <Alert tone="warning" title="Database not configured">
          Set DATABASE_URL and run the migrations.
        </Alert>
      </PageShell>
    );
  }

  const [contactRows, draftRows, suppressionRows, ai] = await Promise.all([
    listContacts(user.id),
    listDrafts(user.id),
    listSuppressions(user.id),
    aiAvailability(user.id, 'outreach_draft'),
  ]);

  const suppressedEmails = new Set(suppressionRows.map((s) => s.email));
  const contactMap = new Map(contactRows.map((c) => [c.id, c]));

  const jobIds = [...new Set(draftRows.map((d) => d.jobId).filter((id): id is string => Boolean(id)))];
  const jobRows = jobIds.length
    ? await getDb().select({ id: jobs.id, title: jobs.title, company: jobs.company }).from(jobs).where(inArray(jobs.id, jobIds))
    : [];
  const jobMap = new Map(jobRows.map((j) => [j.id, j]));

  return (
    <PageShell>
      <PageHeader
        title="Outreach"
        description="Contacts you have a legitimate way to reach, drafts you can review and edit, and the emails you have actually sent — every send required your explicit confirmation."
      />
      <OutreachView
        contacts={contactRows.map((c) => ({
          id: c.id,
          name: c.name,
          title: c.title,
          company: c.company,
          email: c.email,
          linkedinUrl: c.linkedinUrl,
          source: c.source as ContactSource,
          provenance: c.provenance,
          notes: c.notes,
          createdAt: c.createdAt.toISOString(),
          suppressed: c.email ? suppressedEmails.has(c.email) : false,
        }))}
        drafts={draftRows.map((d) => {
          const contact = d.contactId ? contactMap.get(d.contactId) : undefined;
          const job = d.jobId ? jobMap.get(d.jobId) : undefined;
          return {
            id: d.id,
            subject: d.subject,
            status: d.status,
            contactName: contact?.name ?? 'Unknown contact',
            jobLabel: job ? `${job.title} at ${job.company}` : null,
            updatedAt: d.updatedAt.toISOString(),
          };
        })}
        suppressions={suppressionRows.map((s) => ({
          email: s.email,
          reason: s.reason,
          createdAt: s.createdAt.toISOString(),
        }))}
        aiAvailable={ai.available}
      />
    </PageShell>
  );
}
