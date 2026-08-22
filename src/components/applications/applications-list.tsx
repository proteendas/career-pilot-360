'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApplicationStatusBadge } from './status-badge';
import { changeApplicationStatusAction, withdrawApplicationAction } from '@/server/actions/applications';
import { transitionsForActor, type ApplicationStatus } from '@/lib/applications/state';
import { relativeTime } from '@/lib/utils';

export interface ApplicationRow {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  status: ApplicationStatus;
  updatedAt: string;
  submittedAt: string | null;
}

export function ApplicationsList({ applications }: { applications: ApplicationRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function changeStatus(id: string, toStatus: ApplicationStatus) {
    setBusyId(id);
    const res = await changeApplicationStatusAction({ applicationId: id, toStatus });
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not update status.');
      return;
    }
    toast.success(res.notice ?? 'Updated.');
    router.refresh();
  }

  async function withdraw(id: string) {
    setBusyId(id);
    const res = await withdrawApplicationAction(id);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not withdraw.');
      return;
    }
    toast.success('Withdrawn.');
    router.refresh();
  }

  if (applications.length === 0) {
    return (
      <EmptyState
        icon={<Send className="size-5" />}
        title="No applications yet"
        description="Prepare a packet from a job's detail page to start tracking it here."
        action={
          <Button asChild>
            <Link href="/jobs">Go to Jobs</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {applications.map((app) => {
        const options = transitionsForActor(app.status, 'user').filter(
          (s) => !['submitted_by_user', 'submitted_by_connector', 'withdrawn'].includes(s),
        );
        return (
          <li key={app.id}>
            <Card className="transition-shadow hover:shadow-lift">
              <CardContent className="flex flex-wrap items-center gap-4 pt-5">
                <div className="min-w-[12rem] flex-1">
                  <Link href={`/applications/${app.id}`} className="text-[15px] font-semibold text-ink hover:text-accent">
                    {app.jobTitle}
                  </Link>
                  <p className="text-sm text-ink-3">{app.company}</p>
                  <p className="text-xs text-ink-4">
                    Updated {relativeTime(app.updatedAt)}
                    {app.submittedAt ? ` · Submitted ${relativeTime(app.submittedAt)}` : ''}
                  </p>
                </div>

                <ApplicationStatusBadge status={app.status} />

                <div className="flex shrink-0 items-center gap-2">
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/applications/${app.id}`}>
                      Review
                      <ChevronRight aria-hidden />
                    </Link>
                  </Button>
                  {options.length > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" disabled={busyId === app.id}>
                          Change status
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {options.map((s) => (
                          <DropdownMenuItem key={s} onSelect={() => void changeStatus(app.id, s)}>
                            {s.replace(/_/g, ' ')}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem destructive onSelect={() => void withdraw(app.id)}>
                          Withdraw
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
