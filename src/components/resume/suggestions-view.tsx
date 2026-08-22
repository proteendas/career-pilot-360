'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Check,
  CircleSlash,
  Info,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { DiffViewer } from '@/components/ui/diff-viewer';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { acceptAllSafeAction, analyzeResumeAction, decideSuggestionAction } from '@/server/actions/resume';
import { diffStats } from '@/lib/diff';

export interface SuggestionRow {
  id: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  sectionPath: string | null;
  originalText: string;
  suggestedText: string;
  reason: string;
  evidence: { source?: string; quote?: string; origin?: string } | null;
  safeToAutoApply: boolean;
  status: string;
  userEditedText: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  weak_verb: 'Wording',
  missing_metric: 'Missing metric',
  unsupported_claim: 'Unsupported claim',
  wording: 'AI rewrite',
  keyword: 'Keywords',
  formatting: 'Formatting',
  contact: 'Contact',
  structure: 'Structure',
  summary: 'Summary',
};

const PRIORITY_TONE = { high: 'danger', medium: 'warning', low: 'neutral' } as const;

function SuggestionCard({
  suggestion,
  onDecide,
  busy,
}: {
  suggestion: SuggestionRow;
  onDecide: (id: string, decision: 'accept' | 'reject' | 'edit', text?: string) => Promise<void>;
  busy: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(suggestion.suggestedText || suggestion.originalText);

  const hasReplacement = Boolean(suggestion.suggestedText);
  const stats = hasReplacement ? diffStats(suggestion.originalText, suggestion.suggestedText) : null;
  const isAi = suggestion.evidence?.origin === 'ai';

  return (
    <li className="rounded-xl border border-line bg-surface p-4 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={PRIORITY_TONE[suggestion.priority]}>{suggestion.priority}</Badge>
        <Badge tone="outline">{CATEGORY_LABEL[suggestion.category] ?? suggestion.category}</Badge>
        {suggestion.safeToAutoApply ? (
          <Badge tone="success">
            <ShieldCheck aria-hidden />
            Safe to auto-apply
          </Badge>
        ) : null}
        {isAi ? (
          <Badge tone="accent">
            <Sparkles aria-hidden />
            AI
          </Badge>
        ) : (
          <Badge tone="info">Deterministic</Badge>
        )}
        {stats ? (
          <span className="ml-auto text-[11px] text-ink-4">
            +{stats.added} / −{stats.removed} words
          </span>
        ) : null}
      </div>

      {hasReplacement ? (
        <>
          <DiffViewer
            before={suggestion.originalText}
            after={editing ? draft : suggestion.suggestedText}
            mode="split"
            beforeLabel="Current"
            afterLabel={editing ? 'Your edit' : 'Suggested'}
          />
          {editing ? (
            <div className="mt-3">
              <label htmlFor={`edit-${suggestion.id}`} className="mb-1.5 block text-xs font-medium text-ink-2">
                Your replacement text
              </label>
              <Textarea
                id={`edit-${suggestion.id}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                maxLength={1000}
                autoFocus
              />
              <p className="mt-1 text-[11px] text-ink-4">
                Figures that do not appear in your resume or profile will be refused when you save.
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {suggestion.originalText ? (
            <p className="cp-prose-plain rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-ink-2">
              {suggestion.originalText}
            </p>
          ) : null}
          <Alert tone="info" className="mt-3" icon={<Info className="size-4" />}>
            <p className="text-[13px] leading-relaxed">
              This is guidance rather than a replacement — there is no text to apply automatically, because supplying it
              would mean inventing information.
            </p>
          </Alert>
        </>
      )}

      <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{suggestion.reason}</p>

      {suggestion.evidence?.quote ? (
        <details className="mt-2.5 group">
          <summary className="cursor-pointer text-[11px] font-medium text-ink-4 hover:text-ink-2">
            Evidence for this suggestion
          </summary>
          <p className="cp-prose-plain mt-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-3">
            <span className="font-medium text-ink-2">{suggestion.evidence.source ?? 'source'}:</span>{' '}
            {suggestion.evidence.quote}
          </p>
        </details>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {hasReplacement && !editing ? (
          <Button size="sm" onClick={() => void onDecide(suggestion.id, 'accept')} disabled={busy}>
            <Check aria-hidden />
            Accept
          </Button>
        ) : null}

        {editing ? (
          <>
            <Button
              size="sm"
              onClick={() => void onDecide(suggestion.id, 'edit', draft)}
              disabled={busy || !draft.trim() || draft.trim() === suggestion.originalText.trim()}
            >
              <Check aria-hidden />
              Save my version
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel edit
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
            <Pencil aria-hidden />
            {hasReplacement ? 'Edit' : 'Write my own'}
          </Button>
        )}

        <Button size="sm" variant="ghost" onClick={() => void onDecide(suggestion.id, 'reject')} disabled={busy}>
          <X aria-hidden />
          Dismiss
        </Button>
      </div>
    </li>
  );
}

export function SuggestionsView({
  versionId,
  versionName,
  suggestions: initial,
  aiConfigured,
  aiReason,
}: {
  versionId: string;
  versionName: string;
  suggestions: SuggestionRow[];
  aiConfigured: boolean;
  aiReason?: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [regenerating, setRegenerating] = React.useState(false);
  const [confirmAll, setConfirmAll] = React.useState(false);
  const [notice, setNotice] = React.useState<string>();

  const pending = initial.filter((s) => s.status === 'pending');
  const decided = initial.filter((s) => s.status !== 'pending');
  const safeCount = pending.filter((s) => s.safeToAutoApply && s.suggestedText).length;

  async function decide(id: string, decision: 'accept' | 'reject' | 'edit', text?: string) {
    setBusyId(id);
    const res = await decideSuggestionAction({
      suggestionId: id,
      decision,
      ...(text ? { editedText: text } : {}),
    });
    setBusyId(null);

    if (!res.ok) {
      toast.error(res.error ?? 'That change could not be applied.');
      return;
    }
    toast.success(res.notice ?? 'Done.');

    // Accepting produces a new version, so navigate to it — otherwise the user
    // would keep editing the previous one.
    if (res.data?.newVersionId && res.data.newVersionId !== versionId) {
      router.push(`/resume/${res.data.newVersionId}/suggestions`);
    }
    router.refresh();
  }

  async function regenerate() {
    setRegenerating(true);
    setNotice(undefined);
    const res = await analyzeResumeAction(versionId);
    setRegenerating(false);
    if (!res.ok || !res.data) {
      toast.error(res.error ?? 'Could not regenerate suggestions.');
      return;
    }
    if (res.data.aiNotice) setNotice(res.data.aiNotice);
    toast.success(`${res.data.suggestionCount} suggestion(s) generated.`);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ink">{versionName}</h2>
              <p className="text-xs text-ink-4">
                {pending.length} pending · {decided.length} decided
                {safeCount > 0 ? ` · ${safeCount} safe to auto-apply` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void regenerate()} loading={regenerating}>
                <RefreshCw aria-hidden />
                Regenerate
              </Button>
              {safeCount > 0 ? (
                <Button size="sm" onClick={() => setConfirmAll(true)}>
                  <Wand2 aria-hidden />
                  Accept {safeCount} safe change{safeCount === 1 ? '' : 's'}
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="sm">
                <Link href={`/resume/${versionId}/analysis`}>Back to analysis</Link>
              </Button>
            </div>
          </div>

          {notice ? (
            <Alert tone="warning" className="mt-4">
              <p className="text-[13px] leading-relaxed">{notice}</p>
            </Alert>
          ) : null}

          {!aiConfigured && aiReason ? (
            <Alert tone="info" className="mt-4">
              <p className="text-[13px] leading-relaxed">
                {aiReason} The deterministic suggestions below still work —{' '}
                <Link href="/settings/ai-providers" className="font-medium text-accent hover:underline">
                  connect a provider
                </Link>{' '}
                to add AI rewrites.
              </p>
            </Alert>
          ) : null}

          <Alert tone="neutral" className="mt-4" icon={<ShieldCheck className="size-4" />}>
            <p className="text-[13px] leading-relaxed">
              Accepting a suggestion creates a <strong className="font-semibold text-ink">new version</strong> — your
              current wording is never overwritten. Only mechanical rewrites are ever marked safe to auto-apply; an AI
              rewrite always needs your read.
            </p>
          </Alert>
        </CardContent>
      </Card>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending
            {pending.length > 0 ? <Badge tone="outline">{pending.length}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="decided">
            Decided
            {decided.length > 0 ? <Badge tone="outline">{decided.length}</Badge> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {pending.length === 0 ? (
            <EmptyState
              icon={<BadgeCheck className="size-5" />}
              title="Nothing pending"
              description="You have reviewed every suggestion for this version. Re-run the analysis after editing to generate more."
              action={
                <Button variant="secondary" onClick={() => void regenerate()} loading={regenerating}>
                  Regenerate suggestions
                </Button>
              }
            />
          ) : (
            <ul className="space-y-3">
              {pending.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} onDecide={decide} busy={busyId === s.id} />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="decided">
          {decided.length === 0 ? (
            <EmptyState
              icon={<CircleSlash className="size-5" />}
              title="No decisions yet"
              description="Accepted, edited and dismissed suggestions are kept here as a record."
            />
          ) : (
            <ul className="space-y-2.5">
              {decided.map((s) => (
                <li key={s.id} className="rounded-lg border border-line bg-surface-2 p-3.5">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        s.status === 'rejected' ? 'neutral' : s.status === 'edited' ? 'info' : 'success'
                      }
                    >
                      {s.status}
                    </Badge>
                    <Badge tone="outline">{CATEGORY_LABEL[s.category] ?? s.category}</Badge>
                  </div>
                  <p className="cp-prose-plain text-[13px] text-ink-3">
                    {s.userEditedText || s.suggestedText || s.originalText}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={`Apply ${safeCount} safe change${safeCount === 1 ? '' : 's'}?`}
        description="These are mechanical rewrites only."
        details={
          <ul className="space-y-1.5">
            <li>· Only suggestions marked “safe to auto-apply” are included.</li>
            <li>· Each replaces a weak opening with a direct verb; the claim is unchanged.</li>
            <li>· AI rewrites are excluded — those always need your read.</li>
            <li>· A new version is created. Nothing is overwritten.</li>
          </ul>
        }
        confirmLabel={`Apply ${safeCount} change${safeCount === 1 ? '' : 's'}`}
        loading={busyId === 'all'}
        onConfirm={async () => {
          setBusyId('all');
          const res = await acceptAllSafeAction(versionId);
          setBusyId(null);
          setConfirmAll(false);
          if (!res.ok) {
            toast.error(res.error ?? 'Could not apply those changes.');
            return;
          }
          toast.success(res.notice ?? 'Applied.');
          if (res.data?.newVersionId) router.push(`/resume/${res.data.newVersionId}/suggestions`);
          router.refresh();
        }}
      />
    </div>
  );
}
