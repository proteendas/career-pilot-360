import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const alertVariants = cva('relative flex gap-3 rounded-lg border p-3.5 text-sm', {
  variants: {
    tone: {
      info: 'border-info/30 bg-info-soft text-ink-2',
      success: 'border-success/30 bg-success-soft text-ink-2',
      warning: 'border-warning/40 bg-warning-soft text-ink-2',
      danger: 'border-danger/40 bg-danger-soft text-ink-2',
      neutral: 'border-line bg-surface-2 text-ink-2',
    },
  },
  defaultVariants: { tone: 'info' },
});

const iconFor = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: ShieldAlert,
  neutral: Info,
} as const;

const iconTone = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  neutral: 'text-ink-3',
} as const;

export interface AlertProps
  extends Omit<React.ComponentProps<'div'>, 'title'>,
    VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  hideIcon?: boolean;
}

export function Alert({ className, tone = 'info', title, icon, hideIcon, children, ...props }: AlertProps) {
  const Icon = iconFor[tone ?? 'info'];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {hideIcon ? null : (
        <span className={cn('mt-0.5 shrink-0', iconTone[tone ?? 'info'])} aria-hidden>
          {icon ?? <Icon className="size-4" />}
        </span>
      )}
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-semibold text-ink">{title}</p> : null}
        {children ? <div className="leading-relaxed [&_p]:leading-relaxed">{children}</div> : null}
      </div>
    </div>
  );
}
