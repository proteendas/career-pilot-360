import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { GitBranch, History } from 'lucide-react';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { requireUserPage } from '@/lib/auth';
import { getDb, resumeAnalyses, resumeVersions } from '@/lib/db';
import { NotFoundError } from '@/lib/db/tenant';
import { getVersion } from '@/lib/resume/service';
import { formatDateTime, scoreTone } from '@/lib/utils';

export const metadata: Metadata = { title: 'Version history' };

/** Loaded before any JSX exists, so `notFound()` can run first. */
async function load(userId: string, versionId: string) {
  try {
    const current = await getVersion(userId, versionId);
    const db = getDb();

    const [all, scores] = await Promise.all([
      db
        .select({
          id: resumeVersions.id,
          name: resumeVersions.name,
          parentVersionId: resumeVersions.parentVersionId,
          isDefault: resumeVersions.isDefault,
          isTailored: resumeVersions.isTailored,
          template: resumeVersions.template,
          createdAt: resumeVersions.createdAt,
        })
        .from(resumeVersions)
        .where(eq(resumeVersions.userId, userId))
        .orderBy(desc(resumeVersions.createdAt)),
      db
        .select({ versionId: resumeAnalyses.resumeVersionId, score: resumeAnalyses.overallScore, createdAt: resumeAnalyses.createdAt })
        .from(resumeAnalyses)
        .where(eq(resumeAnalyses.userId, userId))
        .orderBy(desc(resumeAnalyses.createdAt)),
    ]);

    return { current, all, scores };
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export default async function VersionHistoryPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const user = await requireUserPage(`/resume/${versionId}/versions`);

  const loaded = await load(user.id, versionId);
  if (!loaded) notFound();
  const { current, all, scores } = loaded;

  const scoreByVersion = new Map<string, number>();
  for (const s of scores) if (!scoreByVersion.has(s.versionId)) scoreByVersion.set(s.versionId, s.score);

  // Build the lineage chain for the current version, oldest first.
  // `guard` breaks any cycle a corrupted parent pointer could introduce.
  type VersionRow = (typeof all)[number];
  const byId = new Map<string, VersionRow>(all.map((v) => [v.id, v]));
  const lineage: VersionRow[] = [];
  const guard = new Set<string>();
  let cursor: string | null = versionId;
  while (cursor !== null && !guard.has(cursor)) {
    const node: VersionRow | undefined = byId.get(cursor);
    if (!node) break;
    guard.add(cursor);
    lineage.unshift(node);
    cursor = node.parentVersionId;
  }

  const descendants = all.filter((v) => v.parentVersionId === versionId);

  return (
      <PageShell>
        <PageHeader
          title="Version history"
          description="History is append-only. Restoring an earlier version creates a new one rather than rewinding, so nothing you have written is ever lost."
          actions={
            <Button asChild variant="secondary">
              <Link href="/resume">All versions</Link>
            </Button>
          }
        />

        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="size-4 text-ink-3" aria-hidden />
                Lineage of “{current.name}”
              </CardTitle>
              <CardDescription>Oldest first. Each step is a version you can open or restore.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-4 pl-6">
                <span className="absolute top-2 bottom-2 left-[7px] w-px bg-line" aria-hidden />
                {lineage.map((v) => {
                  const score = scoreByVersion.get(v.id) ?? null;
                  const isCurrent = v.id === versionId;
                  return (
                    <li key={v.id} className="relative">
                      <span
                        className={
                          isCurrent
                            ? 'absolute top-1.5 -left-6 size-[15px] rounded-full border-2 border-accent bg-surface'
                            : 'absolute top-1.5 -left-6 size-[15px] rounded-full border-2 border-line-strong bg-surface'
                        }
                        aria-hidden
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {isCurrent ? (
                          <span className="text-sm font-semibold text-ink">{v.name}</span>
                        ) : (
                          <Link
                            href={`/resume/${v.id}/analysis`}
                            className="text-sm font-medium text-ink hover:text-accent"
                          >
                            {v.name}
                          </Link>
                        )}
                        {isCurrent ? <Badge tone="accent">Viewing</Badge> : null}
                        {v.isDefault ? <Badge tone="success">Default</Badge> : null}
                        {v.isTailored ? <Badge tone="info">Tailored</Badge> : null}
                        {score !== null ? (
                          <Badge
                            tone={scoreTone(score) === 'success' ? 'success' : scoreTone(score) === 'warning' ? 'warning' : 'danger'}
                          >
                            {score}/100
                          </Badge>
                        ) : (
                          <Badge tone="outline">Not analysed</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-ink-4">
                        {formatDateTime(v.createdAt)} · {v.template} template
                      </p>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          <aside className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="size-4 text-ink-3" aria-hidden />
                  Derived from this
                </CardTitle>
                <CardDescription>Versions created by accepting a suggestion here.</CardDescription>
              </CardHeader>
              <CardContent>
                {descendants.length === 0 ? (
                  <p className="text-sm text-ink-4">Nothing derived from this version yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {descendants.map((v) => (
                      <li key={v.id}>
                        <Link
                          href={`/resume/${v.id}/analysis`}
                          className="block rounded-lg border border-line p-2.5 transition-colors hover:bg-surface-2"
                        >
                          <p className="truncate text-[13px] font-medium text-ink">{v.name}</p>
                          <p className="text-[11px] text-ink-4">{formatDateTime(v.createdAt)}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Alert tone="info">
              <p className="text-[13px] leading-relaxed">
                Your original uploaded file is separate from all of this and is never modified. Download it any time
                from the Resume Center.
              </p>
            </Alert>
          </aside>
        </div>
    </PageShell>
  );
}
