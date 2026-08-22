'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { createContactAction, updateContactAction } from '@/server/actions/outreach';
import { CONTACT_SOURCE_LABELS, type ContactSource } from '@/lib/outreach/contact-types';

export interface ContactFormValues {
  contactId?: string;
  name: string;
  title: string;
  company: string;
  email: string;
  linkedinUrl: string;
  source: ContactSource;
  provenance: string;
  notes: string;
}

const EMPTY: ContactFormValues = {
  name: '',
  title: '',
  company: '',
  email: '',
  linkedinUrl: '',
  source: 'user_provided',
  provenance: '',
  notes: '',
};

const SOURCE_OPTIONS = Object.entries(CONTACT_SOURCE_LABELS).map(([value, label]) => ({ value, label }));

export function ContactFormDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing contact; omitted when creating one. */
  initial?: ContactFormValues;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {/*
          Mounted only while open, and re-keyed per edit target, so the form
          always starts from the right values with no reset effect needed —
          closing (or switching targets) simply unmounts and remounts it.
        */}
        {open ? (
          <ContactFormBody onOpenChange={onOpenChange} initial={initial} key={initial?.contactId ?? 'new'} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ContactFormBody({
  onOpenChange,
  initial,
}: {
  onOpenChange: (open: boolean) => void;
  initial?: ContactFormValues;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial?.contactId);
  const [values, setValues] = React.useState<ContactFormValues>(initial ?? EMPTY);
  const [saving, setSaving] = React.useState(false);

  function set<K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function save() {
    if (!values.name.trim()) {
      toast.error('Enter the contact’s name.');
      return;
    }
    if (!values.provenance.trim()) {
      toast.error('Say where this contact came from — that’s the compliance record for this address.');
      return;
    }
    setSaving(true);
    const res = isEdit
      ? await updateContactAction({
          contactId: initial!.contactId,
          name: values.name,
          title: values.title || undefined,
          company: values.company || undefined,
          email: values.email || undefined,
          linkedinUrl: values.linkedinUrl || undefined,
          notes: values.notes || undefined,
        })
      : await createContactAction({
          name: values.name,
          title: values.title || undefined,
          company: values.company || undefined,
          email: values.email || undefined,
          linkedinUrl: values.linkedinUrl || undefined,
          source: values.source,
          provenance: values.provenance,
          notes: values.notes || undefined,
        });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save this contact.');
      return;
    }
    toast.success(res.notice ?? 'Saved.');
    onOpenChange(false);
    router.refresh();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit contact' : 'Add a contact'}</DialogTitle>
        <DialogDescription>
          Only contacts you provide, or that come from a public company page or an authorised API, can be saved
          here — nothing is ever scraped or guessed.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3.5">
          <Field label="Name" htmlFor="contact-name" required>
            <Input id="contact-name" value={values.name} onChange={(e) => set('name', e.target.value)} maxLength={160} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Title" htmlFor="contact-title">
              <Input id="contact-title" value={values.title} onChange={(e) => set('title', e.target.value)} maxLength={160} />
            </Field>
            <Field label="Company" htmlFor="contact-company">
              <Input id="contact-company" value={values.company} onChange={(e) => set('company', e.target.value)} maxLength={160} />
            </Field>
          </div>

          <Field label="Email" htmlFor="contact-email" help="Required before you can send anything to this contact.">
            <Input
              id="contact-email"
              type="email"
              value={values.email}
              onChange={(e) => set('email', e.target.value)}
              maxLength={254}
            />
          </Field>

          <Field label="LinkedIn URL" htmlFor="contact-linkedin" help="For your own reference and draft-and-copy messages only — never sent by this app.">
            <Input
              id="contact-linkedin"
              value={values.linkedinUrl}
              onChange={(e) => set('linkedinUrl', e.target.value)}
              maxLength={2048}
              placeholder="https://www.linkedin.com/in/…"
            />
          </Field>

          {!isEdit ? (
            <Field label="Where did this contact come from?" htmlFor="contact-source" required>
              <SimpleSelect
                id="contact-source"
                value={values.source}
                onValueChange={(v) => set('source', v as ContactSource)}
                options={SOURCE_OPTIONS}
              />
            </Field>
          ) : null}

          {!isEdit ? (
            <Field
              label="Provenance"
              htmlFor="contact-provenance"
              required
              help="A short note on exactly where this came from, e.g. “Their email signature on a reply to my application.” This is kept as part of the compliance record."
            >
              <Input
                id="contact-provenance"
                value={values.provenance}
                onChange={(e) => set('provenance', e.target.value)}
                maxLength={300}
              />
            </Field>
          ) : null}

          <Field label="Notes" htmlFor="contact-notes">
            <Textarea id="contact-notes" value={values.notes} onChange={(e) => set('notes', e.target.value)} rows={2} maxLength={1000} />
          </Field>
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={saving}>
          {isEdit ? 'Save changes' : 'Add contact'}
        </Button>
      </DialogFooter>
    </>
  );
}
