'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Info, Link2, PencilLine, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { importJobAction, previewJobUrlAction, type UrlPreviewPayload } from '@/server/actions/jobs';

export function ImportJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import a job</DialogTitle>
          <DialogDescription>
            Paste a URL, or type the details yourself. Nothing is fetched from a platform that does not permit it.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="url">
          <TabsList>
            <TabsTrigger value="url">
              <Link2 aria-hidden />
              From a URL
            </TabsTrigger>
            <TabsTrigger value="manual">
              <PencilLine aria-hidden />
              Type it myself
            </TabsTrigger>
          </TabsList>
          <TabsContent value="url">
            <UrlImportForm
              onImported={() => {
                onOpenChange(false);
                router.refresh();
              }}
            />
          </TabsContent>
          <TabsContent value="manual">
            <ManualImportForm
              onImported={() => {
                onOpenChange(false);
                router.refresh();
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ by URL */

function UrlImportForm({ onImported }: { onImported: () => void }) {
  const [url, setUrl] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [preview, setPreview] = React.useState<UrlPreviewPayload | null>(null);
  const [error, setError] = React.useState<string>();
  const [saving, setSaving] = React.useState(false);

  // Editable copies, so the user corrects whatever the extraction got wrong.
  const [title, setTitle] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [location, setLocation] = React.useState('');

  async function fetchPreview() {
    if (!url.trim()) return;
    setLoading(true);
    setError(undefined);
    setPreview(null);
    const res = await previewJobUrlAction(url.trim());
    setLoading(false);

    if (!res.ok || !res.data) {
      setError(res.error ?? 'Could not read that URL.');
      return;
    }
    setPreview(res.data);
    setTitle(res.data.job.title);
    setCompany(res.data.job.company);
    setDescription(res.data.job.description);
    setLocation(res.data.job.location);
  }

  async function save() {
    if (!preview) return;
    setSaving(true);
    const res = await importJobAction({
      title,
      company,
      description,
      location,
      url: url.trim(),
      adapterKey: preview.adapterKey,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save that job.');
      return;
    }
    toast.success(res.notice ?? 'Saved.');
    onImported();
  }

  return (
    <div className="space-y-4 pt-2">
      <Field
        label="Job URL"
        htmlFor="import-url"
        help="LinkedIn, Naukri, Indeed and Glassdoor links are stored as a link only — nothing is fetched from them."
      >
        <div className="flex gap-2">
          <Input
            id="import-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://boards.greenhouse.io/acme/jobs/12345"
            onKeyDown={(e) => e.key === 'Enter' && void fetchPreview()}
          />
          <Button onClick={() => void fetchPreview()} loading={loading} disabled={!url.trim()}>
            Read
          </Button>
        </div>
      </Field>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {preview && !preview.fetched ? (
        <>
          <Alert tone="warning" icon={<ShieldAlert className="size-4" />} title="This link will not be fetched">
            <p className="text-[13px] leading-relaxed">{preview.note}</p>
          </Alert>
          <p className="text-sm text-ink-3">
            Add the title, company and description yourself, and we will store this as an{' '}
            <Badge tone="neutral">external link only</Badge>.
          </p>
          <ManualFields
            title={title}
            setTitle={setTitle}
            company={company}
            setCompany={setCompany}
            description={description}
            setDescription={setDescription}
            location={location}
            setLocation={setLocation}
          />
        </>
      ) : preview?.fetched ? (
        <>
          <Alert tone="info" icon={<Info className="size-4" />}>
            <p className="text-[13px] leading-relaxed">{preview.note}</p>
          </Alert>
          {preview.injectionWarning ? (
            <Alert tone="warning" icon={<ShieldAlert className="size-4" />}>
              <p className="text-[13px] leading-relaxed">{preview.injectionWarning}</p>
            </Alert>
          ) : null}
          <ManualFields
            title={title}
            setTitle={setTitle}
            company={company}
            setCompany={setCompany}
            description={description}
            setDescription={setDescription}
            location={location}
            setLocation={setLocation}
          />
          {preview.job.skills.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">Skills detected</p>
              <div className="flex flex-wrap gap-1.5">
                {preview.job.skills.map((s) => (
                  <Badge key={s} tone="outline">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <DialogFooter>
        <Button asChild variant="ghost">
          <a href={url || undefined} target="_blank" rel="noreferrer noopener">
            <ExternalLink aria-hidden />
            Open the page
          </a>
        </Button>
        <Button
          onClick={() => void save()}
          loading={saving}
          disabled={!preview || !title.trim() || !company.trim()}
        >
          Save job
        </Button>
      </DialogFooter>
    </div>
  );
}

/* -------------------------------------------------------------- manual --- */

function ManualFields({
  title,
  setTitle,
  company,
  setCompany,
  description,
  setDescription,
  location,
  setLocation,
}: {
  title: string;
  setTitle: (v: string) => void;
  company: string;
  setCompany: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Job title" htmlFor="m-title" required>
        <Input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>
      <Field label="Company" htmlFor="m-company" required>
        <Input id="m-company" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={200} />
      </Field>
      <Field label="Location" htmlFor="m-location" className="sm:col-span-2">
        <Input id="m-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={160} />
      </Field>
      <Field label="Description" htmlFor="m-description" required className="sm:col-span-2">
        <Textarea
          id="m-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={8}
          maxLength={60_000}
        />
      </Field>
    </div>
  );
}

function ManualImportForm({ onImported }: { onImported: () => void }) {
  const [title, setTitle] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    const res = await importJobAction({ title, company, description, location, adapterKey: 'manual' });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save that job.');
      return;
    }
    toast.success(res.notice ?? 'Saved.');
    onImported();
  }

  return (
    <div className="space-y-4 pt-2">
      <Alert tone="neutral">
        <p className="text-[13px] leading-relaxed">
          Paste the description from wherever you found it. This is recorded as <Badge tone="neutral">added
          manually</Badge> — nothing is fetched.
        </p>
      </Alert>
      <ManualFields
        title={title}
        setTitle={setTitle}
        company={company}
        setCompany={setCompany}
        description={description}
        setDescription={setDescription}
        location={location}
        setLocation={setLocation}
      />
      <DialogFooter>
        <Button
          onClick={() => void save()}
          loading={saving}
          disabled={!title.trim() || !company.trim() || description.trim().length < 30}
        >
          Save job
        </Button>
      </DialogFooter>
    </div>
  );
}
