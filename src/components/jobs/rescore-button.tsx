'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { rescoreAllAction } from '@/server/actions/jobs';

export function RescoreButton() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  async function run() {
    setLoading(true);
    const res = await rescoreAllAction();
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not rescore.');
      return;
    }
    toast.success(res.notice ?? 'Rescored.');
    router.refresh();
  }

  return (
    <Button variant="secondary" onClick={() => void run()} loading={loading}>
      <RefreshCw aria-hidden />
      Rescore all
    </Button>
  );
}
