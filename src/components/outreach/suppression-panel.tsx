'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Ban, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/alert';
import { suppressEmailAction, unsuppressEmailAction } from '@/server/actions/outreach';
import { relativeTime } from '@/lib/utils';

export interface SuppressionRow {
  email: string;
  reason: string;
  createdAt: string;
}

export function SuppressionPanel({ suppressions }: { suppressions: SuppressionRow[] }) {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [busyEmail, setBusyEmail] = React.useState<string | null>(null);

  async function add() {
    if (!email.trim()) return;
    setAdding(true);
    const res = await suppressEmailAction(email.trim());
    setAdding(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not add that address.');
      return;
    }
    toast.success(res.notice ?? 'Added.');
    setEmail('');
    router.refresh();
  }

  async function remove(addr: string) {
    setBusyEmail(addr);
    const res = await unsuppressEmailAction(addr);
    setBusyEmail(null);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not remove that address.');
      return;
    }
    toast.success(res.notice ?? 'Removed.');
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <Alert tone="neutral" icon={<ShieldOff className="size-4" />}>
        <p className="text-[13px] leading-relaxed">
          Anyone on this list can never be emailed by this account, from any draft — this is an absolute veto, not a
          preference.
        </p>
      </Alert>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-5">
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="suppress-email" className="mb-1.5 block text-sm font-medium text-ink-2">
              Add an address
            </label>
            <Input
              id="suppress-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </div>
          <Button onClick={() => void add()} loading={adding} disabled={!email.trim()}>
            <Ban aria-hidden />
            Add to stop-contact list
          </Button>
        </CardContent>
      </Card>

      {suppressions.length === 0 ? (
        <EmptyState title="No addresses on your stop-contact list" tone="default" />
      ) : (
        <ul className="space-y-2">
          {suppressions.map((s) => (
            <li key={s.email}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                  <div>
                    <p className="text-sm font-medium text-ink">{s.email}</p>
                    <p className="text-xs text-ink-4">
                      {s.reason.replace(/_/g, ' ')} · added {relativeTime(s.createdAt)}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => void remove(s.email)} loading={busyEmail === s.email}>
                    Remove
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
