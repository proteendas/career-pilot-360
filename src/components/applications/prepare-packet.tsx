'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Info, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { CheckboxField } from '@/components/ui/checkbox';
import { SourceBadge } from '@/components/jobs/source-badge';
import { generatePacketAction } from '@/server/actions/applications';
import type { JobSourceType } from '@/lib/jobs/registry';

export function PreparePacketView({
  job,
  aiConfigured,
  aiReason,
  hasResume,
}: {
  job: { id: string; title: string; company: string; sourceType: JobSourceType; sourceName: string; sourcePolicyNote: string | null };
  aiConfigured: boolean;
  aiReason?: string;
  hasResume: boolean;
}) {
  const router = useRouter();
  const [useAi, setUseAi] = React.useState(aiConfigured);
  const [loading, setLoading] = React.useState(false);

  async function generate() {
    setLoading(true);
    const res = await generatePacketAction(job.id, { useAi });
    setLoading(false);

    if (!res.ok || !res.data) {
      toast.error(res.error ?? 'Could not prepare the packet.');
      return;
    }
    toast.success(res.notice ?? 'Packet prepared.');
    router.push(`/applications/${res.data.applicationId}/review`);
  }

  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Prepare an application packet</CardTitle>
          <SourceBadge sourceType={job.sourceType} sourceName={job.sourceName} policyNote={job.sourcePolicyNote} />
        </div>
        <CardDescription>
          {job.title} at {job.company}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasResume ? (
          <Alert tone="warning">Upload a resume before preparing a packet.</Alert>
        ) : (
          <>
            <Alert tone="neutral" icon={<Info className="size-4" />}>
              <p className="text-[13px] leading-relaxed">
                This builds a cover letter, screening answers, outreach drafts, a tailored resume version (reordered,
                never rewritten), and a checklist. You review and approve everything before anything is sent or
                submitted.
              </p>
            </Alert>

            <CheckboxField
              id="use-ai"
              label={
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-accent" aria-hidden />
                  Use AI to write the cover letter and outreach drafts
                </span>
              }
              description={
                aiConfigured
                  ? 'Every AI sentence is checked against your resume and profile — anything with an unsupported figure is discarded automatically.'
                  : aiReason
              }
              checked={useAi}
              onCheckedChange={setUseAi}
              disabled={!aiConfigured}
            />

            <Button onClick={() => void generate()} loading={loading} className="w-full">
              <Wand2 aria-hidden />
              Prepare packet
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
