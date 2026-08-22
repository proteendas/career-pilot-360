'use client';

import { assessPassword } from '@/lib/auth/password';
import { cn } from '@/lib/utils';

const LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;
const TONES = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'] as const;

/**
 * Live password feedback. `assessPassword` is a pure function shared with the
 * server, so the client hint and the server rule can never disagree.
 */
export function PasswordStrength({
  password,
  email,
  name,
  id,
}: {
  password: string;
  email?: string;
  name?: string;
  id: string;
}) {
  if (!password) return null;
  const { score, problems } = assessPassword(password, { email: email ?? '', name: name ?? '' });

  return (
    <div id={id} className="space-y-1.5" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn('h-1 flex-1 rounded-full transition-colors', i < score ? TONES[score] : 'bg-line')}
            />
          ))}
        </div>
        <span className="w-14 shrink-0 text-right text-[11px] font-medium text-ink-4">{LABELS[score]}</span>
      </div>
      {problems[0] ? <p className="text-xs text-ink-4">{problems[0]}</p> : null}
    </div>
  );
}
