import Link from 'next/link';
import { History, Mail, Send, FileText } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { relativeTime } from '@/lib/utils';
import type { HistoryItem } from '@/lib/history';

const TYPE_ICON = {
  application: Send,
  outreach: Mail,
  resume: FileText,
} as const;

export function HistoryTimeline({ items }: { items: HistoryItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<History className="size-5" />}
        title="No history yet"
        description="Application updates, sent outreach, and new resume versions will appear here as they happen."
      />
    );
  }

  return (
    <ol className="space-y-1">
      {items.map((item) => {
        const Icon = TYPE_ICON[item.type];
        return (
          <li key={`${item.type}-${item.id}`}>
            <Link
              href={item.href}
              className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2"
            >
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-3">
                <Icon className="size-3.5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{item.title}</p>
                {item.detail ? <p className="truncate text-xs text-ink-3">{item.detail}</p> : null}
              </div>
              <span className="shrink-0 text-xs text-ink-4">{relativeTime(item.createdAt)}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
