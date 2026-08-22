import { Check, Circle, ExternalLink, FileText, Send, ShieldAlert, X } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

export interface TimelineEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: string;
  createdAt: string;
}

const ICONS: Record<string, typeof Check> = {
  'application.created': FileText,
  'application.approved': Check,
  'application.external_portal_opened': ExternalLink,
  'application.marked_submitted': Send,
  'application.withdrawn': X,
  'application.status_changed': Circle,
};

const ACTOR_LABEL: Record<string, string> = {
  user: 'You',
  system: 'Scheduled task',
  assistant: 'Assistant',
  connector: 'Connector',
};

function eventLabel(event: TimelineEvent): string {
  switch (event.eventType) {
    case 'application.created':
      return 'Application created';
    case 'application.approved':
      return 'Packet approved';
    case 'application.external_portal_opened':
      return 'Opened the employer’s application portal';
    case 'application.marked_submitted':
      return 'Marked as submitted';
    case 'application.withdrawn':
      return 'Withdrawn';
    default:
      return event.toStatus ? `Status changed to ${event.toStatus.replace(/_/g, ' ')}` : 'Status changed';
  }
}

export function ApplicationTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-4">No events yet.</p>;
  }

  return (
    <ol className="relative space-y-4 pl-6">
      <span className="absolute top-2 bottom-2 left-[7px] w-px bg-line" aria-hidden />
      {events.map((event) => {
        const Icon = ICONS[event.eventType] ?? Circle;
        return (
          <li key={event.id} className="relative">
            <span
              className="absolute top-0.5 -left-6 flex size-[15px] items-center justify-center rounded-full border-2 border-accent bg-surface text-accent"
              aria-hidden
            >
              <Icon className="size-2.5" />
            </span>
            <p className="text-sm font-medium text-ink">{eventLabel(event)}</p>
            <p className="text-xs text-ink-4">
              {formatDateTime(event.createdAt)} · {ACTOR_LABEL[event.actorType] ?? event.actorType}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function SafetyReminder() {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-4">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      This history is append-only and visible in your{' '}
      <a href="/audit" className="text-accent hover:underline">
        audit log
      </a>
      .
    </p>
  );
}
