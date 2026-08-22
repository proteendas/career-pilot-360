'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Exactly what will happen, itemised. Shown before any external side effect. */
  details?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  loading?: boolean;
  /** When set, the user must type this string to enable the confirm button. */
  requireTyped?: string;
  onConfirm: () => void | Promise<void>;
}

/**
 * The single confirmation surface for irreversible or outward-facing actions.
 * It always shows *what* will happen before asking for consent.
 */
export function ConfirmDialog({ open, onOpenChange, ...rest }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Radix unmounts the content when closed, so the typed-confirmation state
        inside `ConfirmDialogBody` is discarded on every close. That is why
        there is no reset effect here.
      */}
      <ConfirmDialogBody onOpenChange={onOpenChange} {...rest} />
    </Dialog>
  );
}

function ConfirmDialogBody({
  onOpenChange,
  title,
  description,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  loading,
  requireTyped,
  onConfirm,
}: Omit<ConfirmDialogProps, 'open'>) {
  const [typed, setTyped] = React.useState('');
  const blocked = Boolean(requireTyped) && typed.trim() !== requireTyped;

  return (
    <>
      <DialogContent size="md" role="alertdialog">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
                tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent',
              )}
            >
              <AlertTriangle className="size-4" aria-hidden />
            </span>
            <div className="space-y-1.5">
              <DialogTitle>{title}</DialogTitle>
              {description ? <DialogDescription>{description}</DialogDescription> : null}
            </div>
          </div>
        </DialogHeader>

        {details ? (
          <div className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-2">
            {details}
          </div>
        ) : null}

        {requireTyped ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-ink-2">
              Type <span className="font-mono font-semibold text-ink">{requireTyped}</span> to continue
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="h-10 rounded-lg border border-line-strong bg-surface px-3 font-mono text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]"
            />
          </label>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => void onConfirm()}
            loading={loading}
            disabled={blocked}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </>
  );
}
