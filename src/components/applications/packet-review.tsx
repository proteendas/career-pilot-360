'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  Info,
  Mail,
  Pencil,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/input';
import { CopyButton } from '@/components/ui/copy-button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CheckboxField } from '@/components/ui/checkbox';
import { DiffViewer } from '@/components/ui/diff-viewer';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { ApplicationStatusBadge } from './status-badge';
import { SourceBadge } from '@/components/jobs/source-badge';
import {
  approveApplicationAction,
  markSubmittedAction,
  recordPortalOpenedAction,
  updatePacketAction,
  updateScreeningAnswerAction,
} from '@/server/actions/applications';
import { SENSITIVE_CATEGORY_LABELS } from '@/lib/applications/screening';
import type { ApplicationStatus } from '@/lib/applications/state';
import type { JobSourceType } from '@/lib/jobs/registry';

export interface ScreeningAnswerView {
  question: string;
  answer: string;
  needsUserInput: boolean;
  reason: string;
  category: string | null;
  source: string;
}

export interface PacketReviewData {
  applicationId: string;
  packetId: string;
  status: ApplicationStatus;
  job: {
    id: string;
    title: string;
    company: string;
    applyUrl: string | null;
    sourceType: JobSourceType;
    sourceName: string;
    sourcePolicyNote: string | null;
  };
  coverLetter: string;
  shortSummary: string;
  emailSubject: string;
  recruiterEmail: string;
  linkedinMessage: string;
  screeningAnswers: ScreeningAnswerView[];
  keySkills: string[];
  checklist: { id: string; label: string; done: boolean }[];
  warnings: { severity: 'high' | 'medium' | 'low'; title: string; detail: string }[];
  diff: {
    addedWords?: number;
    removedWords?: number;
    addedKeywords?: string[];
    removedKeywords?: string[];
    tailoringNotes?: string[];
  } | null;
  originalResumeText: string;
  tailoredResumeText: string;
  tailoredResumeVersionId: string | null;
}

const WARNING_TONE = { high: 'danger', medium: 'warning', low: 'neutral' } as const;

export function PacketReviewView({ data }: { data: PacketReviewData }) {
  const router = useRouter();
  const [coverLetter, setCoverLetter] = React.useState(data.coverLetter);
  const [recruiterEmail, setRecruiterEmail] = React.useState(data.recruiterEmail);
  const [linkedinMessage, setLinkedinMessage] = React.useState(data.linkedinMessage);
  const [answers, setAnswers] = React.useState(data.screeningAnswers);
  const [saving, setSaving] = React.useState(false);
  const [openConfirm, setOpenConfirm] = React.useState(false);
  const [submitConfirm, setSubmitConfirm] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const needsInput = answers.filter((a) => a.needsUserInput);
  const canApprove = data.status === 'draft' || data.status === 'ready_for_review' || data.status === 'needs_user_input';
  const canOpenPortal = ['approved', 'opened_externally', 'in_progress'].includes(data.status);
  const canMarkSubmitted = ['approved', 'opened_externally', 'in_progress'].includes(data.status);
  const alreadySubmitted = ['submitted_by_user', 'submitted_by_connector', 'interview', 'offer'].includes(data.status);

  async function saveEdits() {
    setSaving(true);
    const res = await updatePacketAction({
      packetId: data.packetId,
      coverLetter,
      recruiterEmail,
      linkedinMessage,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save.');
      return;
    }
    toast.success('Saved.');
    router.refresh();
  }

  async function saveAnswer(index: number, value: string) {
    const res = await updateScreeningAnswerAction({ packetId: data.packetId, questionIndex: index, answer: value });
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save that answer.');
      return;
    }
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, answer: value, needsUserInput: false, source: 'profile_custom_answer' };
      return next;
    });
    toast.success('Answer saved.');
  }

  async function approve() {
    const res = await approveApplicationAction(data.applicationId);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not approve.');
      return;
    }
    toast.success('Approved.');
    router.refresh();
  }

  async function openPortal() {
    if (!data.job.applyUrl) return;
    window.open(data.job.applyUrl, '_blank', 'noopener,noreferrer');
    const res = await recordPortalOpenedAction(data.applicationId, data.job.applyUrl);
    setOpenConfirm(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not record that the portal was opened.');
      return;
    }
    toast.success('Recorded.');
    router.refresh();
  }

  async function markSubmitted() {
    setSubmitting(true);
    const res = await markSubmittedAction({
      applicationId: data.applicationId,
      externalUrl: data.job.applyUrl ?? undefined,
      userNotes: notes || undefined,
      confirmed: true,
    });
    setSubmitting(false);
    setSubmitConfirm(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not record the submission.');
      return;
    }
    toast.success(res.notice ?? 'Marked as submitted.');
    router.refresh();
  }

  function copyAll() {
    const text = [
      `Cover letter:\n${coverLetter}`,
      `Recruiter email (subject: ${data.emailSubject}):\n${recruiterEmail}`,
      `LinkedIn message:\n${linkedinMessage}`,
      ...answers.map((a) => `Q: ${a.question}\nA: ${a.answer || '[not yet answered]'}`),
    ].join('\n\n---\n\n');
    navigator.clipboard.writeText(text).then(
      () => toast.success('Copied everything to your clipboard.'),
      () => toast.error('Your browser blocked clipboard access.'),
    );
  }

  return (
    <div className="space-y-5">
      {/* -------------------------------------------------------- header */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-ink">{data.job.title}</h1>
                <ApplicationStatusBadge status={data.status} />
              </div>
              <p className="text-ink-3">{data.job.company}</p>
            </div>
            <SourceBadge
              sourceType={data.job.sourceType}
              sourceName={data.job.sourceName}
              policyNote={data.job.sourcePolicyNote}
            />
          </div>

          {data.warnings.length > 0 ? (
            <div className="mt-4 space-y-2">
              {data.warnings.map((w, i) => (
                <Alert key={i} tone={WARNING_TONE[w.severity]} icon={<AlertTriangle className="size-4" />}>
                  <p className="text-[13px] font-medium">{w.title}</p>
                  <p className="text-[13px] leading-relaxed">{w.detail}</p>
                </Alert>
              ))}
            </div>
          ) : null}

          <Alert tone="neutral" className="mt-4" icon={<Info className="size-4" />}>
            <p className="text-[13px] leading-relaxed">
              Every generated statement is grounded in your resume, your profile, or your own saved answers. Review
              all of it — nothing here has been sent or submitted yet.
            </p>
          </Alert>
        </CardContent>
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_20rem]">
        {/* --------------------------------------------------------- main */}
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Cover letter</CardTitle>
              <CardDescription>Edit freely — this is entirely yours to change.</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={coverLetter}
                onChange={(e) => setCoverLetter(e.target.value)}
                rows={12}
                maxLength={3000}
              />
              <div className="mt-2 flex justify-end gap-2">
                <CopyButton value={coverLetter} label="Copy" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CircleHelp className="size-4 text-ink-3" aria-hidden />
                Screening answers
              </CardTitle>
              <CardDescription>
                Sensitive questions are never auto-answered. Answer them yourself below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {answers.map((a, i) => (
                <ScreeningAnswerRow key={i} answer={a} onSave={(value) => saveAnswer(i, value)} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="size-4 text-ink-3" aria-hidden />
                Recruiter outreach drafts
              </CardTitle>
              <CardDescription>Copy these, or head to Outreach to send with confirmation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">Email subject</p>
                <p className="text-sm text-ink">{data.emailSubject}</p>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">Recruiter email</p>
                <Textarea value={recruiterEmail} onChange={(e) => setRecruiterEmail(e.target.value)} rows={6} maxLength={2000} />
                <div className="mt-2 flex justify-end">
                  <CopyButton value={recruiterEmail} label="Copy" />
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">
                  LinkedIn message (draft-and-copy only)
                </p>
                <Textarea value={linkedinMessage} onChange={(e) => setLinkedinMessage(e.target.value)} rows={3} maxLength={600} />
                <div className="mt-2 flex justify-end">
                  <CopyButton value={linkedinMessage} label="Copy" />
                </div>
              </div>
              <Button onClick={() => void saveEdits()} loading={saving} size="sm" variant="secondary">
                <Pencil aria-hidden />
                Save my edits
              </Button>
            </CardContent>
          </Card>

          {data.tailoredResumeVersionId ? (
            <Card>
              <CardHeader>
                <CardTitle>Tailored resume comparison</CardTitle>
                <CardDescription>
                  Reordered for this role — same facts, same wording. No content was added or changed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.diff?.tailoringNotes?.length ? (
                  <ul className="space-y-1 text-[13px] text-ink-3">
                    {data.diff.tailoringNotes.map((n, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-4" aria-hidden />
                        {n}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <DiffViewer
                  before={data.originalResumeText}
                  after={data.tailoredResumeText}
                  mode="split"
                  beforeLabel="Original order"
                  afterLabel="Tailored order"
                />
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/resume/${data.tailoredResumeVersionId}/analysis`}>View tailored resume</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* ------------------------------------------------------ sidebar */}
        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-3 pt-5">
              <Button onClick={() => void copyAll()} variant="secondary" className="w-full">
                <Copy aria-hidden />
                Copy all answers
              </Button>
              <Button variant="secondary" className="w-full" disabled>
                <Download aria-hidden />
                Download packet (PDF)
              </Button>

              {needsInput.length > 0 ? (
                <Alert tone="warning">
                  <p className="text-[13px] leading-relaxed">
                    {needsInput.length} question(s) still need your answer before this is complete.
                  </p>
                </Alert>
              ) : null}

              {canApprove ? (
                <Button onClick={() => void approve()} className="w-full">
                  <Check aria-hidden />
                  Approve packet
                </Button>
              ) : null}

              {data.job.applyUrl && canOpenPortal ? (
                <Button variant="secondary" className="w-full" onClick={() => setOpenConfirm(true)}>
                  <ExternalLink aria-hidden />
                  Open application portal
                </Button>
              ) : null}

              {canMarkSubmitted ? (
                <Button variant="secondary" className="w-full" onClick={() => setSubmitConfirm(true)}>
                  <Send aria-hidden />
                  Mark as submitted
                </Button>
              ) : null}

              {alreadySubmitted ? (
                <Alert tone="success">
                  <p className="text-[13px]">You confirmed this application was submitted.</p>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          {data.keySkills.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-[15px]">Skills to emphasize</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-wrap gap-1.5">
                  {data.keySkills.map((s) => (
                    <li key={s}>
                      <Badge tone="outline">{s}</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Checklist</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {data.checklist.map((item) => (
                  <li key={item.id}>
                    <CheckboxField id={item.id} label={item.label} checked={item.done} onCheckedChange={() => undefined} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* --------------------------------------------------------- dialogs */}
      <ConfirmDialog
        open={openConfirm}
        onOpenChange={setOpenConfirm}
        title="Open the application portal?"
        description={`This opens ${data.job.company}'s site in a new tab.`}
        details={
          <p className="break-all">
            <strong className="font-medium text-ink">URL:</strong> {data.job.applyUrl}
          </p>
        }
        confirmLabel="Open in new tab"
        onConfirm={openPortal}
      />

      <ConfirmDialog
        open={submitConfirm}
        onOpenChange={setSubmitConfirm}
        title="Mark this application as submitted?"
        description="This records that you personally completed the application on the employer's site."
        details={
          <div className="space-y-2">
            <p>This action:</p>
            <ul className="space-y-1">
              <li>· Sets the status to “Submitted by you”</li>
              <li>· Stores the submission timestamp in your audit history</li>
              <li>· Cannot be undone (you can withdraw the application afterward instead)</li>
            </ul>
            <label htmlFor="submit-notes" className="mt-2 block text-xs font-medium text-ink-2">
              Notes (optional)
            </label>
            <Textarea
              id="submit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. Submitted via referral portal"
            />
          </div>
        }
        confirmLabel="Yes, I submitted this application"
        tone="default"
        loading={submitting}
        onConfirm={markSubmitted}
      />
    </div>
  );
}

function ScreeningAnswerRow({
  answer,
  onSave,
}: {
  answer: ScreeningAnswerView;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = React.useState(answer.answer);
  const [editing, setEditing] = React.useState(answer.needsUserInput);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    await onSave(value);
    setSaving(false);
    setEditing(false);
  }

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <p className="flex-1 text-sm font-medium text-ink">{answer.question}</p>
        {answer.category ? (
          <SimpleTooltip content={answer.reason}>
            <span className="inline-flex">
              <Badge tone="warning">
                <ShieldAlert aria-hidden />
                {SENSITIVE_CATEGORY_LABELS[answer.category as keyof typeof SENSITIVE_CATEGORY_LABELS] ?? 'Sensitive'}
              </Badge>
            </span>
          </SimpleTooltip>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={2} maxLength={3000} autoFocus />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} loading={saving} disabled={!value.trim()}>
              Save answer
            </Button>
            {!answer.needsUserInput ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] text-ink-2">{answer.answer}</p>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            Edit
          </Button>
        </div>
      )}

      {!editing ? <p className="mt-1.5 text-[11px] text-ink-4">{answer.reason}</p> : null}
    </div>
  );
}
