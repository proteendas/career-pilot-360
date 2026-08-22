'use client';

import * as React from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  ApplicationProfileForm,
  JobPreferencesForm,
  PersonalForm,
  ProfessionalForm,
} from './forms';
import { updateProfileSectionAction, type ProfileSection } from '@/server/actions/account';
import { profileCompleteness, type FullProfile } from '@/lib/profile/types';

const TABS: { id: ProfileSection; label: string }[] = [
  { id: 'personal', label: 'Personal' },
  { id: 'professional', label: 'Professional' },
  { id: 'jobPreferences', label: 'Job preferences' },
  { id: 'applicationProfile', label: 'Application answers' },
];

export function ProfileEditor({ initialProfile }: { initialProfile: FullProfile }) {
  const [profile, setProfile] = React.useState(initialProfile);
  const [saved, setSaved] = React.useState(initialProfile);
  const [savingSection, setSavingSection] = React.useState<ProfileSection | null>(null);

  const completeness = profileCompleteness(profile);

  const dirty = (section: ProfileSection) =>
    JSON.stringify(profile[section]) !== JSON.stringify(saved[section]);

  async function save(section: ProfileSection) {
    setSavingSection(section);
    const res = await updateProfileSectionAction(section, profile[section]);
    setSavingSection(null);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save.');
      return;
    }
    setSaved((prev) => ({ ...prev, [section]: profile[section] }));
    toast.success('Saved.');
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-[14rem] flex-1 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-ink-2">Profile completeness</span>
                <span className="text-lg font-semibold tabular-nums text-ink">{completeness.score}%</span>
              </div>
              <Progress
                value={completeness.score}
                tone={completeness.score >= 75 ? 'success' : completeness.score >= 50 ? 'warning' : 'danger'}
              />
            </div>
            {completeness.missingForMatching.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {completeness.missingForMatching.map((m) => (
                  <li key={m}>
                    <Badge tone="warning">{m}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <Badge tone="success">Everything needed for matching is present</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="personal">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
              {dirty(t.id) ? <span className="size-1.5 rounded-full bg-accent" aria-label="Unsaved changes" /> : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t.id} value={t.id}>
            <Card>
              <CardContent className="pt-6">
                {t.id === 'personal' ? (
                  <PersonalForm value={profile.personal} onChange={(v) => setProfile({ ...profile, personal: v })} />
                ) : null}
                {t.id === 'professional' ? (
                  <ProfessionalForm
                    value={profile.professional}
                    onChange={(v) => setProfile({ ...profile, professional: v })}
                  />
                ) : null}
                {t.id === 'jobPreferences' ? (
                  <JobPreferencesForm
                    value={profile.jobPreferences}
                    onChange={(v) => setProfile({ ...profile, jobPreferences: v })}
                  />
                ) : null}
                {t.id === 'applicationProfile' ? (
                  <ApplicationProfileForm
                    value={profile.applicationProfile}
                    onChange={(v) => setProfile({ ...profile, applicationProfile: v })}
                  />
                ) : null}
              </CardContent>
            </Card>

            <div className="sticky bottom-4 mt-4 flex justify-end">
              <Button
                onClick={() => void save(t.id)}
                loading={savingSection === t.id}
                disabled={!dirty(t.id)}
                className="shadow-pop"
              >
                <Save aria-hidden />
                {dirty(t.id) ? 'Save changes' : 'Saved'}
              </Button>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
