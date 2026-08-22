'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContactsPanel, type ContactRow } from './contacts-panel';
import { DraftsPanel, type DraftRow } from './drafts-panel';
import { SuppressionPanel, type SuppressionRow } from './suppression-panel';

export function OutreachView({
  contacts,
  drafts,
  suppressions,
  aiAvailable,
}: {
  contacts: ContactRow[];
  drafts: DraftRow[];
  suppressions: SuppressionRow[];
  aiAvailable: boolean;
}) {
  return (
    <Tabs defaultValue="contacts">
      <TabsList>
        <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>
        <TabsTrigger value="drafts">Drafts ({drafts.length})</TabsTrigger>
        <TabsTrigger value="suppressed">Stop-contact list ({suppressions.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="contacts">
        <ContactsPanel contacts={contacts} aiAvailable={aiAvailable} />
      </TabsContent>
      <TabsContent value="drafts">
        <DraftsPanel drafts={drafts} />
      </TabsContent>
      <TabsContent value="suppressed">
        <SuppressionPanel suppressions={suppressions} />
      </TabsContent>
    </Tabs>
  );
}
