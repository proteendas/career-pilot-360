/**
 * Minimal word-level diff (LCS based). Pure, dependency-free and synchronous so
 * it can run in a server component or a unit test without a DOM.
 */
export type DiffType = 'equal' | 'insert' | 'delete';

export interface DiffToken {
  type: DiffType;
  value: string;
}

/** Split into words while keeping the whitespace attached, so output re-joins exactly. */
function tokenize(text: string): string[] {
  return (text ?? '').match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Longest-common-subsequence diff over word tokens.
 * Guards against pathological input by falling back to a whole-block
 * replace when either side is very large.
 */
export function diffWords(before: string, after: string): DiffToken[] {
  const a = tokenize(before);
  const b = tokenize(after);

  if (a.length === 0 && b.length === 0) return [];
  if (a.length * b.length > 4_000_000) {
    const out: DiffToken[] = [];
    if (before) out.push({ type: 'delete', value: before });
    if (after) out.push({ type: 'insert', value: after });
    return out;
  }

  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const raw: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      raw.push({ type: 'equal', value: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      raw.push({ type: 'delete', value: a[i]! });
      i++;
    } else {
      raw.push({ type: 'insert', value: b[j]! });
      j++;
    }
  }
  while (i < a.length) raw.push({ type: 'delete', value: a[i++]! });
  while (j < b.length) raw.push({ type: 'insert', value: b[j++]! });

  // Merge adjacent tokens of the same type so the DOM stays small.
  const merged: DiffToken[] = [];
  for (const t of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === t.type) last.value += t.value;
    else merged.push({ ...t });
  }
  return merged;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
  changed: boolean;
}

export function diffStats(before: string, after: string): DiffStats {
  const tokens = diffWords(before, after);
  const count = (t: DiffType) =>
    tokens.filter((x) => x.type === t).reduce((n, x) => n + (x.value.trim() ? x.value.trim().split(/\s+/).length : 0), 0);
  const added = count('insert');
  const removed = count('delete');
  return { added, removed, unchanged: count('equal'), changed: added > 0 || removed > 0 };
}
