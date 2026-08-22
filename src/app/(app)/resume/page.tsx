import type { Metadata } from 'next';
import Link from 'next/link';
import { desc, eq, and, sql } from 'drizzle-orm';
import { Download, FileClock, Info, ShieldCheck } from 'lucide-react';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { UploadCard } from '@/components/resume/upload-card';
import { VersionList, type VersionRow } from '@/components/resume/version-list';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { requireUserPage } from '@/lib/auth';
import {
  getDb,
  isDatabaseConfigured,
  jobs,
  resumeAnalyses,
  resumeDocuments,
  resumeSuggestions,
  resumeVersions,
} from '@/lib/db';
import { storageDriverId } from '@/lib/storage';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Resume Center' };

async function loadVersionRows(userId: string): Promise<VersionRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: resumeVersions.id,
      name: resumeVersions.name,
      isDefault: resumeVersions.isDefault,
      isTailored: resumeVersions.isTailored,
      template: resumeVersions.template,
      createdAt: resumeVersions.createdAt,
      updatedAt: resumeVersions.updatedAt,
      parentVersionId: resumeVersions.parentVersionId,
      pdfBlobPath: resumeVersions.pdfBlobPath,
      jobTitle: jobs.title,
      company: jobs.company,
    })
    .from(resumeVersions)
    .leftJoin(jobs, eq(jobs.id, resumeVersions.jobId))
    .where(eq(resumeVersions.userId, userId))
    .orderBy(desc(resumeVersions.isDefault), desc(resumeVersions.createdAt));

  // Latest score and pending-suggestion count per version, in two grouped
  // queries rather than one per row.
  const [scores, pending] = await Promise.all([
    db
      .select({
        versionId: resumeAnalyses.resumeVersionId,
        score: sql<number>`(array_agg(${resumeAnalyses.overallScore} ORDER BY ${resumeAnalyses.createdAt} DESC))[1]`,
      })
      .from(resumeAnalyses)
      .where(eq(resumeAnalyses.userId, userId))
      .groupBy(resumeAnalyses.resumeVersionId),
    db
      .select({ versionId: resumeSuggestions.resumeVersionId, count: sql<number>`count(*)` })
      .from(resumeSuggestions)
      .where(and(eq(resumeSuggestions.userId, userId), eq(resumeSuggestions.status, 'pending')))
      .groupBy(resumeSuggestions.resumeVersionId),
  ]);

  const scoreMap = new Map(scores.map((s) => [s.versionId, Number(s.score)]));
  const pendingMap = new Map(pending.map((p) => [p.versionId, Number(p.count)]));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    isTailored: r.isTailored,
    template: r.template,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    parentVersionId: r.parentVersionId,
    jobTitle: r.jobTitle,
    company: r.company,
    latestScore: scoreMap.get(r.id) ?? null,
    pendingSuggestions: pendingMap.get(r.id) ?? 0,
    hasPdf: Boolean(r.pdfBlobPath),
  }));
}

async function loadDocuments(userId: string) {
  return getDb()
    .select({
      id: resumeDocuments.id,
      originalFilename: resumeDocuments.originalFilename,
      sizeBytes: resumeDocuments.sizeBytes,
      parsingStatus: resumeDocuments.parsingStatus,
      parsingError: resumeDocuments.parsingError,
      createdAt: resumeDocuments.createdAt,
    })
    .from(resumeDocuments)
    .where(eq(resumeDocuments.userId, userId))
    .orderBy(desc(resumeDocuments.createdAt));
}

export default async function ResumePage() {
  const user = await requireUserPage('/resume');

  if (!isDatabaseConfigured()) {
    return (
      <PageShell>
        <PageHeader title="Resume Center" />
        <Alert tone="warning" title="Database not configured">
          Set <code className="font-mono text-[12px]">DATABASE_URL</code> and run{' '}
          <code className="font-mono text-[12px]">npm run db:migrate</code> to enable resume storage.
        </Alert>
      </PageShell>
    );
  }

  const [versions, documents] = await Promise.all([loadVersionRows(user.id), loadDocuments(user.id)]);
  const driver = storageDriverId();

  return (
    <PageShell>
      <PageHeader
        title="Resume Center"
        description="Upload once, then improve it in versions. Your original file is preserved byte for byte, and every change you accept creates a new version rather than overwriting the last."
        actions={
          versions.length > 0 ? (
            <Button asChild variant="secondary">
              <Link href={`/resume/${versions[0]!.id}/analysis`}>Open latest analysis</Link>
            </Button>
          ) : undefined
        }
      />

      {driver === 'local' ? (
        <Alert tone="info" className="mb-5" icon={<Info className="size-4" />}>
          <p className="text-[13px] leading-relaxed">
            Files are being written to the local filesystem (
            <code className="font-mono text-[12px]">.storage/</code>), because no Blob token is configured. Set{' '}
            <code className="font-mono text-[12px]">BLOB_READ_WRITE_TOKEN</code> for production, where objects are
            stored privately in Vercel Blob and streamed back only through authenticated routes.
          </p>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <UploadCard hasExisting={versions.length > 0} />

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">
              Versions{versions.length > 0 ? ` (${versions.length})` : ''}
            </h2>
            <VersionList versions={versions} />
          </section>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileClock className="size-4 text-ink-3" aria-hidden />
                Original uploads
              </CardTitle>
              <CardDescription>Immutable. Download exactly what you uploaded, at any time.</CardDescription>
            </CardHeader>
            <CardContent>
              {documents.length === 0 ? (
                <p className="py-3 text-sm text-ink-4">Nothing uploaded yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {documents.map((doc) => (
                    <li key={doc.id} className="flex items-start gap-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink">{doc.originalFilename}</p>
                        <p className="text-[11px] text-ink-4">
                          {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB · {formatDateTime(doc.createdAt)}
                        </p>
                        {doc.parsingStatus !== 'parsed' ? (
                          <Badge
                            tone={doc.parsingStatus === 'failed' ? 'danger' : 'warning'}
                            className="mt-1"
                          >
                            {doc.parsingStatus === 'failed' ? 'Parse failed' : 'Needs review'}
                          </Badge>
                        ) : null}
                        {doc.parsingError ? (
                          <p className="mt-1 text-[11px] leading-relaxed text-danger">{doc.parsingError}</p>
                        ) : null}
                      </div>
                      <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${doc.originalFilename}`}>
                        <a href={`/api/resume/document/${doc.id}`}>
                          <Download aria-hidden />
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-success" aria-hidden />
                How this works
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5 text-[13px] leading-relaxed text-ink-3">
                <li>
                  <strong className="font-medium text-ink-2">Parsing is local.</strong> Text extraction and the ATS
                  score run on our servers with no AI provider involved.
                </li>
                <li>
                  <strong className="font-medium text-ink-2">The score is a heuristic.</strong> It is built from
                  fourteen documented signals, not from any employer&rsquo;s actual system.
                </li>
                <li>
                  <strong className="font-medium text-ink-2">No invented facts.</strong> Suggestions must cite a source
                  section. A rewrite that introduces a figure absent from your own material is discarded, not shown.
                </li>
                <li>
                  <strong className="font-medium text-ink-2">Nothing is overwritten.</strong> Accepting a suggestion
                  creates a new version, so you can always get your wording back.
                </li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}
