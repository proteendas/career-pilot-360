import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/app-shell/page-header';
import { PacketReviewView, type PacketReviewData } from '@/components/applications/packet-review';
import { requireUserPage } from '@/lib/auth';
import { NotFoundError } from '@/lib/db/tenant';
import { getApplication, getPacket } from '@/lib/applications/service';
import { getJob } from '@/lib/jobs/service';
import { getStructured } from '@/lib/resume/service';
import { resumeToPlainText } from '@/lib/resume/types';
import type { ApplicationStatus } from '@/lib/applications/state';

export const metadata: Metadata = { title: 'Review application' };

async function load(userId: string, applicationId: string) {
  try {
    const app = await getApplication(userId, applicationId);
    if (!app.applicationPacketId) return { app, packet: null, job: null, original: '', tailored: '' };

    const packet = await getPacket(userId, app.applicationPacketId);
    const job = await getJob(userId, app.jobId);

    const [original, tailored] = await Promise.all([
      packet.resumeVersionId ? getStructured(userId, packet.resumeVersionId).then(resumeToPlainText) : Promise.resolve(''),
      packet.tailoredResumeVersionId
        ? getStructured(userId, packet.tailoredResumeVersionId).then(resumeToPlainText)
        : Promise.resolve(''),
    ]);

    return { app, packet, job, original, tailored };
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export default async function ApplicationReviewPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const user = await requireUserPage(`/applications/${applicationId}/review`);

  const loaded = await load(user.id, applicationId);
  if (!loaded || !loaded.packet || !loaded.job) notFound();
  const { app, packet, job, original, tailored } = loaded;

  const data: PacketReviewData = {
    applicationId: app.id,
    packetId: packet.id,
    status: app.status as ApplicationStatus,
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      applyUrl: job.applyUrl ?? job.canonicalUrl,
      sourceType: job.sourceType,
      sourceName: job.sourceName,
      sourcePolicyNote: job.sourcePolicyNote,
    },
    coverLetter: packet.coverLetter,
    shortSummary: packet.shortSummary,
    emailSubject: packet.emailSubject,
    recruiterEmail: packet.recruiterEmail,
    linkedinMessage: packet.linkedinMessage,
    screeningAnswers: (packet.screeningAnswers ?? []) as PacketReviewData['screeningAnswers'],
    keySkills: (packet.keySkills ?? []) as string[],
    checklist: (packet.checklist ?? []) as PacketReviewData['checklist'],
    warnings: (packet.warnings ?? []) as PacketReviewData['warnings'],
    diff: (packet.diff ?? null) as PacketReviewData['diff'],
    originalResumeText: original,
    tailoredResumeText: tailored,
    tailoredResumeVersionId: packet.tailoredResumeVersionId,
  };

  return (
    <PageShell>
      <PacketReviewView data={data} />
    </PageShell>
  );
}
