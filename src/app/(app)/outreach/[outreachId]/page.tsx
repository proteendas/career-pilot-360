import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { DraftDetailView } from '@/components/outreach/draft-detail';
import { requireUserPage } from '@/lib/auth';
import { NotFoundError } from '@/lib/db/tenant';
import { getDraft } from '@/lib/outreach/drafts';
import { getContact } from '@/lib/outreach/contacts';
import { getJob } from '@/lib/jobs/service';

export const metadata: Metadata = { title: 'Outreach draft' };

async function load(userId: string, draftId: string) {
  try {
    const draft = await getDraft(userId, draftId);
    const [contact, job] = await Promise.all([
      draft.contactId ? getContact(userId, draft.contactId) : null,
      draft.jobId ? getJob(userId, draft.jobId) : null,
    ]);
    return { draft, contact, job };
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export default async function OutreachDraftPage({
  params,
}: {
  params: Promise<{ outreachId: string }>;
}) {
  const { outreachId } = await params;
  const user = await requireUserPage(`/outreach/${outreachId}`);

  const loaded = await load(user.id, outreachId);
  if (!loaded || !loaded.contact) notFound();
  const { draft, contact, job } = loaded;

  return (
    <PageShell>
      <PageHeader title="Outreach draft" description="Review and edit before sending — nothing goes out automatically." />
      <DraftDetailView
        data={{
          draftId: draft.id,
          status: draft.status,
          subject: draft.subject,
          body: draft.body,
          followUpBody: draft.followUpBody ?? '',
          linkedinMessage: draft.linkedinMessage ?? '',
          suggestedTiming: draft.suggestedTiming ?? '',
          contact: {
            id: contact.id,
            name: contact.name,
            title: contact.title,
            company: contact.company,
            email: contact.email,
          },
          jobLabel: job ? `${job.title} at ${job.company}` : null,
        }}
      />
    </PageShell>
  );
}
