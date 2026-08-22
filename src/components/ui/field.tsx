import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';

export interface FieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  help?: React.ReactNode;
  error?: string | undefined;
  className?: string;
  children: React.ReactNode;
}

/**
 * Accessible form row: the control is described by its help text and, when
 * present, its error message - both wired through aria-describedby by the
 * consumer using `${htmlFor}-help` / `${htmlFor}-error`.
 */
export function Field({ label, htmlFor, required, help, error, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {help && !error ? (
        <p id={`${htmlFor}-help`} className="text-xs leading-relaxed text-ink-4">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Compute the aria-describedby value for a field's control. */
export function describedBy(id: string, opts: { help?: unknown; error?: unknown }): string | undefined {
  const ids = [opts.help && !opts.error ? `${id}-help` : null, opts.error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}
