import { Badge } from '@/components/ui/badge';
import { STATUS_META, type ApplicationStatus } from '@/lib/applications/state';

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const meta = STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
