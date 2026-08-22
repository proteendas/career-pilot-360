'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, GripVertical, Plus, Save, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { ScoreRing } from '@/components/ui/score-ring';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimpleSelect } from '@/components/ui/select';
import { CheckboxField } from '@/components/ui/checkbox';
import { TagInput } from '@/components/profile/tag-input';
import { exportPdfAction, saveResumeContentAction } from '@/server/actions/resume';
import { analyzeResume } from '@/lib/resume/ats';
import { RESUME_TEMPLATES, TEMPLATE_META, type ResumeTemplate } from '@/lib/resume/pdf';
import type { StructuredResume } from '@/lib/resume/types';

/**
 * Structured resume editor.
 *
 * Scoring runs locally on every keystroke — the ATS engine is a pure function,
 * so there is no round trip and no reason to debounce a network call. Saving is
 * explicit, and creates a new content revision on the same version.
 */
export function ResumeEditor({
  versionId,
  versionName,
  initialContent,
  initialTemplate,
  atsContext,
}: {
  versionId: string;
  versionName: string;
  initialContent: StructuredResume;
  initialTemplate: string;
  atsContext: Parameters<typeof analyzeResume>[1];
}) {
  const router = useRouter();
  const [content, setContent] = React.useState(initialContent);
  const [saved, setSaved] = React.useState(initialContent);
  const [saving, setSaving] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const [template, setTemplate] = React.useState<ResumeTemplate>(
    (RESUME_TEMPLATES as readonly string[]).includes(initialTemplate)
      ? (initialTemplate as ResumeTemplate)
      : 'modern',
  );
  const [fontSize, setFontSize] = React.useState(10);
  const [margin, setMargin] = React.useState(52);
  const [lineSpacing, setLineSpacing] = React.useState(1.36);
  const [singlePage, setSinglePage] = React.useState(false);

  // Pure, synchronous, no network.
  const report = React.useMemo(() => analyzeResume(content, atsContext), [content, atsContext]);
  const dirty = React.useMemo(() => JSON.stringify(content) !== JSON.stringify(saved), [content, saved]);

  async function save() {
    setSaving(true);
    const res = await saveResumeContentAction(versionId, content);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save.');
      return;
    }
    setSaved(content);
    toast.success(`Saved. Heuristic score ${res.data?.score ?? report.overallScore}/100.`);
    router.refresh();
  }

  async function exportPdf() {
    if (dirty) {
      toast.error('Save your changes first — the PDF is rendered from the saved version.');
      return;
    }
    setExporting(true);
    const res = await exportPdfAction({
      versionId,
      template,
      fontSize,
      margin,
      lineSpacing,
      pageMode: singlePage ? 'single' : 'multi',
    });
    setExporting(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Export failed.');
      return;
    }
    toast.success(res.notice ?? 'PDF generated.');
    window.location.href = `/api/resume/${versionId}/pdf`;
  }

  /* ------------------------------------------------------------- mutators */

  const setContact = <K extends keyof StructuredResume['contact']>(
    key: K,
    value: StructuredResume['contact'][K],
  ) => setContent((c) => ({ ...c, contact: { ...c.contact, [key]: value } }));

  const updateExperience = (index: number, patch: Partial<StructuredResume['experience'][number]>) =>
    setContent((c) => {
      const experience = [...c.experience];
      const existing = experience[index];
      if (!existing) return c;
      experience[index] = { ...existing, ...patch };
      return { ...c, experience };
    });

  const updateBullet = (expIndex: number, bulletIndex: number, text: string) =>
    setContent((c) => {
      const experience = [...c.experience];
      const role = experience[expIndex];
      if (!role) return c;
      const bullets = [...role.bullets];
      const bullet = bullets[bulletIndex];
      if (!bullet) return c;
      // Edited by hand, so provenance becomes 'user' — the fabrication guard
      // only polices system-authored text.
      bullets[bulletIndex] = { ...bullet, text, source: 'user' };
      experience[expIndex] = { ...role, bullets };
      return { ...c, experience };
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      {/* ------------------------------------------------------------ editor */}
      <div className="min-w-0 space-y-4">
        <Tabs defaultValue="contact">
          <TabsList>
            <TabsTrigger value="contact">Contact</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="experience">
              Experience
              <Badge tone="outline">{content.experience.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
          </TabsList>

          <TabsContent value="contact">
            <Card>
              <CardHeader>
                <CardTitle>Contact details</CardTitle>
                <CardDescription>These appear at the top of the exported PDF.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" htmlFor="e-name" required>
                  <Input id="e-name" value={content.contact.fullName} onChange={(e) => setContact('fullName', e.target.value)} />
                </Field>
                <Field label="Headline" htmlFor="e-headline" help="A short role line under your name.">
                  <Input id="e-headline" value={content.contact.headline} onChange={(e) => setContact('headline', e.target.value)} />
                </Field>
                <Field label="Email" htmlFor="e-email" required>
                  <Input id="e-email" type="email" value={content.contact.email} onChange={(e) => setContact('email', e.target.value)} />
                </Field>
                <Field label="Phone" htmlFor="e-phone">
                  <Input id="e-phone" value={content.contact.phone} onChange={(e) => setContact('phone', e.target.value)} />
                </Field>
                <Field label="Location" htmlFor="e-location">
                  <Input id="e-location" value={content.contact.location} onChange={(e) => setContact('location', e.target.value)} />
                </Field>
                <Field label="LinkedIn" htmlFor="e-linkedin">
                  <Input id="e-linkedin" value={content.contact.linkedinUrl} onChange={(e) => setContact('linkedinUrl', e.target.value)} />
                </Field>
                <Field label="GitHub" htmlFor="e-github">
                  <Input id="e-github" value={content.contact.githubUrl} onChange={(e) => setContact('githubUrl', e.target.value)} />
                </Field>
                <Field label="Portfolio" htmlFor="e-portfolio">
                  <Input id="e-portfolio" value={content.contact.portfolioUrl} onChange={(e) => setContact('portfolioUrl', e.target.value)} />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="summary">
            <Card>
              <CardHeader>
                <CardTitle>Professional summary</CardTitle>
                <CardDescription>
                  Two or three sentences in your own words. Write what you have actually done.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={content.summary}
                  onChange={(e) => setContent((c) => ({ ...c, summary: e.target.value, summarySource: 'user' }))}
                  rows={5}
                  maxLength={3000}
                  aria-label="Professional summary"
                />
                <p className="mt-1.5 text-xs text-ink-4">{content.summary.length}/3000 characters</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="experience">
            <div className="space-y-4">
              {content.experience.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-ink-4">
                    No roles were parsed from your document. Add one below.
                  </CardContent>
                </Card>
              ) : null}

              {content.experience.map((exp, i) => (
                <Card key={i}>
                  <CardContent className="space-y-4 pt-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Job title" htmlFor={`exp-title-${i}`}>
                        <Input
                          id={`exp-title-${i}`}
                          value={exp.title}
                          onChange={(e) => updateExperience(i, { title: e.target.value })}
                        />
                      </Field>
                      <Field label="Company" htmlFor={`exp-company-${i}`}>
                        <Input
                          id={`exp-company-${i}`}
                          value={exp.company}
                          onChange={(e) => updateExperience(i, { company: e.target.value })}
                        />
                      </Field>
                      <Field label="Location" htmlFor={`exp-loc-${i}`}>
                        <Input
                          id={`exp-loc-${i}`}
                          value={exp.location}
                          onChange={(e) => updateExperience(i, { location: e.target.value })}
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="From" htmlFor={`exp-start-${i}`} help="e.g. Mar 2021">
                          <Input
                            id={`exp-start-${i}`}
                            value={exp.startDate}
                            onChange={(e) => updateExperience(i, { startDate: e.target.value })}
                          />
                        </Field>
                        <Field label="To" htmlFor={`exp-end-${i}`}>
                          <Input
                            id={`exp-end-${i}`}
                            value={exp.current ? '' : exp.endDate}
                            disabled={exp.current}
                            onChange={(e) => updateExperience(i, { endDate: e.target.value })}
                          />
                        </Field>
                      </div>
                    </div>

                    <CheckboxField
                      id={`exp-current-${i}`}
                      label="This is my current role"
                      checked={exp.current}
                      onCheckedChange={(v) => updateExperience(i, { current: v, endDate: v ? '' : exp.endDate })}
                    />

                    <div className="space-y-2">
                      <p className="text-sm font-medium text-ink-2">Bullets</p>
                      {exp.bullets.map((bullet, j) => (
                        <div key={j} className="flex items-start gap-2">
                          <GripVertical className="mt-2.5 size-4 shrink-0 text-ink-4" aria-hidden />
                          <Textarea
                            value={bullet.text}
                            onChange={(e) => updateBullet(i, j, e.target.value)}
                            rows={2}
                            maxLength={1000}
                            aria-label={`Bullet ${j + 1} for ${exp.title || 'role'}`}
                            className="min-h-16"
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="mt-1.5"
                            aria-label="Remove bullet"
                            onClick={() =>
                              updateExperience(i, { bullets: exp.bullets.filter((_, k) => k !== j) })
                            }
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          updateExperience(i, {
                            bullets: [
                              ...exp.bullets,
                              { id: `new-${Date.now()}`, text: '', source: 'user' as const },
                            ],
                          })
                        }
                      >
                        <Plus aria-hidden />
                        Add bullet
                      </Button>
                    </div>

                    <Field label="Technologies" htmlFor={`exp-tech-${i}`}>
                      <TagInput
                        id={`exp-tech-${i}`}
                        value={exp.technologies}
                        onChange={(v) => updateExperience(i, { technologies: v })}
                        max={60}
                      />
                    </Field>

                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setContent((c) => ({ ...c, experience: c.experience.filter((_, k) => k !== i) }))
                        }
                      >
                        <Trash2 aria-hidden />
                        Remove role
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              <Button
                variant="secondary"
                onClick={() =>
                  setContent((c) => ({
                    ...c,
                    experience: [
                      ...c.experience,
                      {
                        id: `new-${Date.now()}`,
                        title: '',
                        company: '',
                        location: '',
                        startDate: '',
                        endDate: '',
                        current: false,
                        summary: '',
                        bullets: [],
                        technologies: [],
                        source: 'user' as const,
                      },
                    ],
                  }))
                }
              >
                <Plus aria-hidden />
                Add a role
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="skills">
            <Card>
              <CardHeader>
                <CardTitle>Skills</CardTitle>
                <CardDescription>
                  Grouped by category. List only what you can speak to in an interview.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {content.skills.map((group, i) => (
                  <div key={i} className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
                    <Field label="Category" htmlFor={`skill-cat-${i}`}>
                      <Input
                        id={`skill-cat-${i}`}
                        value={group.category}
                        placeholder="Languages"
                        onChange={(e) =>
                          setContent((c) => {
                            const skills = [...c.skills];
                            const existing = skills[i];
                            if (!existing) return c;
                            skills[i] = { ...existing, category: e.target.value };
                            return { ...c, skills };
                          })
                        }
                      />
                    </Field>
                    <Field label="Skills" htmlFor={`skill-list-${i}`}>
                      <TagInput
                        id={`skill-list-${i}`}
                        value={group.skills}
                        onChange={(v) =>
                          setContent((c) => {
                            const skills = [...c.skills];
                            const existing = skills[i];
                            if (!existing) return c;
                            skills[i] = { ...existing, skills: v };
                            return { ...c, skills };
                          })
                        }
                        max={80}
                      />
                    </Field>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setContent((c) => ({ ...c, skills: c.skills.filter((_, k) => k !== i) }))}
                      >
                        <Trash2 aria-hidden />
                        Remove group
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setContent((c) => ({
                      ...c,
                      skills: [...c.skills, { id: `new-${Date.now()}`, category: '', skills: [], source: 'user' as const }],
                    }))
                  }
                >
                  <Plus aria-hidden />
                  Add a group
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ------------------------------------------------------------ sidebar */}
      <aside className="space-y-4">
        <Card className="lg:sticky lg:top-20">
          <CardContent className="pt-5">
            <div className="flex flex-col items-center gap-2">
              <ScoreRing score={report.overallScore} size={104} label="ATS" animate={false} />
              <p className="text-[11px] text-ink-4">Updates as you type</p>
            </div>

            <div className="mt-4 space-y-2">
              <Button onClick={() => void save()} loading={saving} disabled={!dirty} className="w-full">
                <Save aria-hidden />
                {dirty ? 'Save changes' : 'Saved'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void exportPdf()}
                loading={exporting}
                disabled={dirty}
                className="w-full"
              >
                <Download aria-hidden />
                Export PDF
              </Button>
              <Button asChild variant="ghost" size="sm" className="w-full">
                <Link href={`/resume/${versionId}/analysis`}>Full analysis</Link>
              </Button>
            </div>

            {dirty ? (
              <Alert tone="warning" className="mt-3" icon={<ShieldAlert className="size-4" />}>
                <p className="text-[13px] leading-relaxed">
                  Unsaved changes. The PDF renders from the saved version, so save before exporting.
                </p>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">PDF options</CardTitle>
            <CardDescription>{TEMPLATE_META[template].atsNote}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Template" htmlFor="tpl">
              <SimpleSelect
                id="tpl"
                value={template}
                onValueChange={(v) => setTemplate(v as ResumeTemplate)}
                options={RESUME_TEMPLATES.map((t) => ({ value: t, label: TEMPLATE_META[t].label }))}
              />
            </Field>

            <label className="block text-sm font-medium text-ink-2" htmlFor="fs">
              Font size: <span className="tabular-nums">{fontSize}pt</span>
            </label>
            <input
              id="fs"
              type="range"
              min={8}
              max={12}
              step={0.5}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-full accent-[var(--cp-accent)]"
            />

            <label className="block text-sm font-medium text-ink-2" htmlFor="mg">
              Margin: <span className="tabular-nums">{margin}pt</span>
            </label>
            <input
              id="mg"
              type="range"
              min={28}
              max={80}
              step={2}
              value={margin}
              onChange={(e) => setMargin(Number(e.target.value))}
              className="w-full accent-[var(--cp-accent)]"
            />

            <label className="block text-sm font-medium text-ink-2" htmlFor="ls">
              Line spacing: <span className="tabular-nums">{lineSpacing.toFixed(2)}</span>
            </label>
            <input
              id="ls"
              type="range"
              min={1.05}
              max={1.8}
              step={0.02}
              value={lineSpacing}
              onChange={(e) => setLineSpacing(Number(e.target.value))}
              className="w-full accent-[var(--cp-accent)]"
            />

            <CheckboxField
              id="single-page"
              label="Try to fit one page"
              description="Compresses spacing. You are told if the content still does not fit."
              checked={singlePage}
              onCheckedChange={setSinglePage}
            />

            <p className="text-xs leading-relaxed text-ink-4">
              Estimated {report.stats.estimatedPages} page{report.stats.estimatedPages === 1 ? '' : 's'} ·{' '}
              {report.stats.wordCount} words · {report.stats.bulletCount} bullets
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Version</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] font-medium text-ink">{versionName}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-4">
              Edits here update this version in place. Accepting a suggestion, by contrast, creates a new version.
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
