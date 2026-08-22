'use client';

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TagInputProps {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Click-to-add hints. Never auto-applied. */
  suggestions?: string[];
  max?: number;
  describedBy?: string | undefined;
  disabled?: boolean;
}

/**
 * Free-text tag entry for skills, titles and locations.
 *
 * Enter or comma commits. Backspace on an empty field removes the last tag.
 * Duplicates (case-insensitive) are silently ignored rather than rejected with
 * an error, because the user's intent is unambiguous.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  suggestions = [],
  max = 100,
  describedBy,
  disabled,
}: TagInputProps) {
  const [draft, setDraft] = React.useState('');

  const add = React.useCallback(
    (raw: string) => {
      const parts = raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) return;

      const lower = new Set(value.map((v) => v.toLowerCase()));
      const next = [...value];
      for (const p of parts) {
        if (next.length >= max) break;
        if (lower.has(p.toLowerCase())) continue;
        lower.add(p.toLowerCase());
        next.push(p.slice(0, 80));
      }
      onChange(next);
      setDraft('');
    },
    [value, onChange, max],
  );

  const remove = (tag: string) => onChange(value.filter((v) => v !== tag));

  const unusedSuggestions = suggestions
    .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
    .slice(0, 8);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            // A trailing comma means "commit what came before it".
            if (v.endsWith(',')) add(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length > 0) {
              e.preventDefault();
              remove(value[value.length - 1]!);
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={placeholder}
          aria-describedby={describedBy}
        />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => add(draft)}
          disabled={disabled || !draft.trim() || value.length >= max}
          aria-label="Add"
        >
          <Plus aria-hidden />
        </Button>
      </div>

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected values">
          {value.map((tag) => (
            <li key={tag}>
              <span className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-surface-2 py-0.5 pr-0.5 pl-2 text-xs font-medium text-ink-2">
                {tag}
                <button
                  type="button"
                  onClick={() => remove(tag)}
                  disabled={disabled}
                  className="rounded p-0.5 text-ink-4 transition-colors hover:bg-danger-soft hover:text-danger focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {unusedSuggestions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-4">Common:</span>
          {unusedSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              disabled={disabled}
              className={cn(
                'rounded-md border border-dashed border-line-strong px-1.5 py-0.5 text-[11px] text-ink-4 transition-colors',
                'hover:border-accent/50 hover:text-accent focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]',
              )}
            >
              + {s}
            </button>
          ))}
        </div>
      ) : null}

      <p className="text-[11px] text-ink-4">
        {value.length}/{max} · press Enter or comma to add
      </p>
    </div>
  );
}
