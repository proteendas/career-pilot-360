'use client';

import Link from 'next/link';
import { ChevronRight, Mail } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { OutreachStatusBadge } from './outreach-status-badge';
import { relativeTime } from '@/lib/utils';

export interface DraftRow {
  id: string;
  subject: string;
  status: string;
  contactName: string;
  jobLabel: string | null;
  updatedAt: string;
}

export function DraftsPanel({ drafts }: { drafts: DraftRow[] }) {
  if (drafts.length === 0) {
    return (
      <EmptyState
        icon={<Mail className="size-5" />}
        title="No outreach drafts yet"
        description="Prepare a draft from one of your contacts to get started."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {drafts.map((d) => (
        <li key={d.id}>
          <Card className="transition-shadow hover:shadow-lift">
            <CardContent className="flex flex-wrap items-center gap-4 pt-5">
              <div className="min-w-[14rem] flex-1">
                <Link href={`/outreach/${d.id}`} className="text-[15px] font-semibold text-ink hover:text-accent">
                  {d.subject || '(no subject)'}
                </Link>
                <p className="text-sm text-ink-3">
                  To {d.contactName}
                  {d.jobLabel ? ` · ${d.jobLabel}` : ''}
                </p>
                <p className="text-xs text-ink-4">Updated {relativeTime(d.updatedAt)}</p>
              </div>

              <OutreachStatusBadge status={d.status} />

              <Button asChild size="sm" variant="secondary">
                <Link href={`/outreach/${d.id}`}>
                  Open
                  <ChevronRight aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
