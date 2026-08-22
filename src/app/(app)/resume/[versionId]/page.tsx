import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { ResumeEditor } from '@/components/resume/resume-editor';
import { requireUserPage } from '@/lib/auth';
import { NotFoundError } from '@/lib/db/tenant';
import { atsContextFromProfile, getStructured, getVersion } from '@/lib/resume/service';
import { loadProfile } from '@/lib/profile/service';

export const metadata: Metadata = { title: 'Edit resume' };

/** Loaded before any JSX exists, so `notFound()` can run first. */
async function load(userId: string, versionId: string) {
  try {
    return await Promise.all([
      getVersion(userId, versionId),
      getStructured(userId, versionId),
      loadProfile(userId),
    ] as const);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export default async function ResumeEditorPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const user = await requireUserPage(`/resume/${versionId}`);

  const loaded = await load(user.id, versionId);
  if (!loaded) notFound();
  const [version, content, profile] = loaded;

  return (
    <PageShell>
      <PageHeader
        title="Edit resume"
        description="The heuristic score recalculates as you type — the scoring engine is deterministic, so it runs locally with no round trip."
      />
      <ResumeEditor
        versionId={versionId}
        versionName={version.name}
        initialContent={content}
        initialTemplate={version.template}
        atsContext={atsContextFromProfile(profile)}
      />
    </PageShell>
  );
}
