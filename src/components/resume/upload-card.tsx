'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Info, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const MAX_BYTES = 1 * 1024 * 1024;
const ACCEPT = '.pdf,.docx';

interface UploadResponse {
  ok: boolean;
  error?: string;
  code?: string;
  versionId?: string;
  atsScore?: number;
  extractedChars?: number;
  warnings?: string[];
  detectedSections?: string[];
  filledFromProfile?: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Client-side pre-check. The server re-validates from magic bytes regardless. */
function precheck(file: File): string | null {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'doc') return 'Legacy .doc files are not supported. Save as PDF or DOCX and try again.';
  if (ext !== 'pdf' && ext !== 'docx') return 'Only PDF and DOCX resumes are supported.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_BYTES) return `That file is ${formatBytes(file.size)}. The limit is 1 MB.`;
  return null;
}

export function UploadCard({ hasExisting }: { hasExisting: boolean }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState('');
  const [dragging, setDragging] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState<string>();
  const [result, setResult] = React.useState<UploadResponse | null>(null);

  function choose(next: File | null) {
    setError(undefined);
    setResult(null);
    if (!next) {
      setFile(null);
      return;
    }
    const problem = precheck(next);
    if (problem) {
      setError(problem);
      setFile(null);
      return;
    }
    setFile(next);
    if (!name) setName(next.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80));
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError(undefined);
    setProgress(15);

    try {
      const body = new FormData();
      body.append('file', file);
      if (name.trim()) body.append('name', name.trim());

      // Parsing and scoring happen server-side, so the bar is indicative
      // rather than a byte count.
      setProgress(45);
      const res = await fetch('/api/resume/upload', { method: 'POST', body });
      setProgress(85);
      const json = (await res.json()) as UploadResponse;

      if (!res.ok || !json.ok) {
        setError(json.error ?? 'The upload failed.');
        setProgress(0);
        return;
      }

      setProgress(100);
      setResult(json);
      toast.success(`Resume parsed. Heuristic ATS score: ${json.atsScore}/100.`);
      router.refresh();
    } catch {
      setError('The upload could not be completed. Check your connection and try again.');
      setProgress(0);
    } finally {
      setUploading(false);
    }
  }

  if (result?.ok && result.versionId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Resume parsed</CardTitle>
          <CardDescription>
            Heuristic ATS score {result.atsScore}/100 from {result.extractedChars?.toLocaleString('en-US')} characters of
            extracted text.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {result.detectedSections?.length ? (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold tracking-wide text-ink-4 uppercase">Sections found</p>
              <ul className="flex flex-wrap gap-1.5">
                {result.detectedSections.map((s) => (
                  <li key={s}>
                    <Badge tone="success">{s}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.filledFromProfile?.length ? (
            <Alert tone="info">
              <p className="text-[13px] leading-relaxed">
                Filled from your profile because the document did not contain it:{' '}
                <strong className="font-semibold text-ink">{result.filledFromProfile.join(', ')}</strong>. This is your
                own data — nothing was invented.
              </p>
            </Alert>
          ) : null}

          {result.warnings?.length ? (
            <Alert tone="warning" title={`${result.warnings.length} thing(s) worth checking`}>
              <ul className="mt-1 space-y-1.5">
                {result.warnings.map((w) => (
                  <li key={w} className="flex gap-2 text-[13px] leading-relaxed">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-warning" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => router.push(`/resume/${result.versionId}/analysis`)}>View full analysis</Button>
            <Button variant="secondary" onClick={() => router.push(`/resume/${result.versionId}/suggestions`)}>
              Review suggestions
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setResult(null);
                setFile(null);
                setName('');
                setProgress(0);
              }}
            >
              Upload another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{hasExisting ? 'Upload another resume' : 'Upload your resume'}</CardTitle>
        <CardDescription>
          PDF or DOCX, up to 1 MB. Your original file is preserved and never overwritten. Parsing and scoring run on
          our servers with no AI provider involved.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files[0] ?? null);
          }}
          className={cn(
            'relative rounded-xl border-2 border-dashed p-8 text-center transition-colors',
            dragging ? 'border-accent bg-accent-soft/40' : 'border-line-strong bg-surface-2/60',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            id="resume-file"
            disabled={uploading}
          />

          {file ? (
            <div className="flex items-center justify-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <FileText className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-medium text-ink">{file.name}</p>
                <p className="text-xs text-ink-4">{formatBytes(file.size)}</p>
              </div>
              {!uploading ? (
                <Button variant="ghost" size="icon-sm" onClick={() => choose(null)} aria-label="Remove file">
                  <X aria-hidden />
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-ink-3">
                <Upload className="size-5" aria-hidden />
              </span>
              <p className="text-sm font-medium text-ink">Drag a file here, or</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                Choose a file
              </Button>
              <p className="mt-3 text-xs text-ink-4">PDF or DOCX · 1 MB maximum</p>
            </>
          )}
        </div>

        {file ? (
          <Field label="Version name" htmlFor="resume-name" help="How this version appears in your list.">
            <Input
              id="resume-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              disabled={uploading}
              placeholder="Senior Backend Engineer — base"
            />
          </Field>
        ) : null}

        {uploading ? (
          <div className="space-y-1.5">
            <Progress value={progress} />
            <p className="text-xs text-ink-4">
              {progress < 50 ? 'Uploading…' : progress < 90 ? 'Extracting and normalising text…' : 'Scoring…'}
            </p>
          </div>
        ) : null}

        <Alert tone="neutral" icon={<Info className="size-4" />}>
          <p className="text-[13px] leading-relaxed">
            A text-based PDF exported from a word processor parses best. Scans, image exports, tables and multi-column
            layouts are exactly what applicant tracking systems mis-read — if we cannot read it, they probably cannot
            either, and we will tell you.
          </p>
        </Alert>

        <Button onClick={() => void upload()} disabled={!file || uploading} loading={uploading} className="w-full">
          {uploading ? 'Processing…' : 'Upload and analyse'}
        </Button>
      </CardContent>
    </Card>
  );
}
