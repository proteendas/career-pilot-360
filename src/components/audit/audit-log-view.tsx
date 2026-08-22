'use client';

import * as React from 'react';
import { ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { loadMoreAuditEventsAction, type AuditEventRow } from '@/server/actions/audit';
import { formatDateTime } from '@/lib/utils';

const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Authentication',
  profile: 'Profile',
  consent: 'Consent',
  resume: 'Resume',
  job: 'Jobs',
  packet: 'Application packets',
  application: 'Applications',
  outreach: 'Outreach',
  schedule: 'Schedule',
  task: 'Background tasks',
  ai: 'AI providers',
  account: 'Account',
};

function categoryOf(action: string): string {
  return action.split('.')[0] ?? action;
}

export function AuditLogView({ initialEvents }: { initialEvents: AuditEventRow[] }) {
  const [events, setEvents] = React.useState(initialEvents);
  const [category, setCategory] = React.useState('all');
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [exhausted, setExhausted] = React.useState(initialEvents.length < 50);

  const categories = React.useMemo(() => {
    const set = new Set(events.map((e) => categoryOf(e.action)));
    return ['all', ...[...set].sort()];
  }, [events]);

  const visible = category === 'all' ? events : events.filter((e) => categoryOf(e.action) === category);

  async function loadMore() {
    const last = events[events.length - 1];
    if (!last) return;
    setLoadingMore(true);
    const res = await loadMoreAuditEventsAction(last.createdAt);
    setLoadingMore(false);
    if (!res.ok || !res.data) {
      toast.error(res.error ?? 'Could not load more.');
      return;
    }
    setEvents((prev) => [...prev, ...res.data!.events]);
    if (res.data.events.length < 50) setExhausted(true);
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<ScrollText className="size-5" />}
        title="Nothing recorded yet"
        description="Every meaningful action in your account — uploads, submissions, sends, key changes — appears here as soon as it happens."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-3">Category</span>
        <SimpleSelect
          value={category}
          onValueChange={setCategory}
          className="w-56"
          options={categories.map((c) => ({ value: c, label: c === 'all' ? 'All' : CATEGORY_LABELS[c] ?? c }))}
        />
      </div>

      <TableWrap>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>Actor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-xs text-ink-4">{formatDateTime(e.createdAt)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge tone="outline">{CATEGORY_LABELS[categoryOf(e.action)] ?? categoryOf(e.action)}</Badge>
                    <span className="font-mono text-xs text-ink-3">{e.action}</span>
                  </div>
                </TableCell>
                <TableCell className="max-w-md text-[13px]">
                  {e.afterSummary ?? (e.entityType ? `${e.entityType}${e.entityId ? ` · ${e.entityId.slice(0, 8)}…` : ''}` : '—')}
                </TableCell>
                <TableCell className="text-xs text-ink-4 capitalize">{e.actorType}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrap>

      {!exhausted ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
