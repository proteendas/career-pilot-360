'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button, type ButtonProps } from './button';

export interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  value: string;
  label?: string;
  copiedLabel?: string;
  /** Hide the text and show only the icon. */
  iconOnly?: boolean;
}

/** Clipboard copy with a real success state and a graceful fallback. */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  iconOnly,
  variant = 'secondary',
  size = 'sm',
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${copiedLabel} to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Your browser blocked clipboard access. Select the text and copy manually.');
    }
  }

  return (
    <Button variant={variant} size={iconOnly ? 'icon-sm' : size} onClick={() => void copy()} {...props}>
      {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
      {iconOnly ? <span className="sr-only">{copied ? copiedLabel : label}</span> : copied ? copiedLabel : label}
    </Button>
  );
}
