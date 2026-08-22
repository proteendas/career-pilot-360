import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { SuggestionsView, type SuggestionRow } from '@/components/resume/suggestions-view';
import { requireUserPage } from '@/lib/auth';
import { NotFoundError } from '@/lib/db/tenant';
import { getVersion, listSuggestions } from '@/lib/resume/service';
import { aiAvailability } from '@/lib/ai/client';

export const metadata: Metadata = { title: 'Resume suggestions' };

/** Loaded before any JSX exists, so `notFound()` can run first. */
async function load(userId: string, versionId: string) {
  try {
    return await Promise.all([
      getVersion(userId, versionId),
      listSuggestions(userId, versionId),
      aiAvailability(userId, 'resume_suggestions'),
    ] as const);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export default async function SuggestionsPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const user = await requireUserPage(`/resume/${versionId}/suggestions`);

  const loaded = await load(user.id, versionId);
  if (!loaded) notFound();
  const [version, rows, ai] = loaded;

  const suggestions: SuggestionRow[] = rows.map((r) => ({
    id: r.id,
    category: r.category,
    priority: (r.priority === 'high' || r.priority === 'low' ? r.priority : 'medium') as 'high' | 'medium' | 'low',
    sectionPath: r.sectionPath,
    originalText: r.originalText,
    suggestedText: r.suggestedText,
    reason: r.reason,
    evidence: (r.evidence ?? null) as SuggestionRow['evidence'],
    safeToAutoApply: r.safeToAutoApply,
    status: r.status,
    userEditedText: r.userEditedText,
  }));

  return (
    <PageShell>
      <PageHeader
        title="Suggestions"
        description="Every suggestion cites the source that supports it. Anything that would require inventing a fact is shown as guidance for you to act on, not as text to accept."
      />
      <SuggestionsView
        versionId={versionId}
        versionName={version.name}
        suggestions={suggestions}
        aiConfigured={ai.available}
        {...(ai.reason ? { aiReason: ai.reason } : {})}
      />
    </PageShell>
  );
}
