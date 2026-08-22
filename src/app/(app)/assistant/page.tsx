import type { Metadata } from 'next';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { ChatView } from '@/components/assistant/chat-view';
import { requireUserPage } from '@/lib/auth';
import { isDatabaseConfigured } from '@/lib/db';
import { aiAvailability } from '@/lib/ai/client';
import { createConversation, listConversations, listMessages } from '@/lib/assistant/service';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = { title: 'Assistant' };

export default async function AssistantPage() {
  const user = await requireUserPage('/assistant');

  if (!isDatabaseConfigured()) {
    return (
      <PageShell>
        <PageHeader title="Assistant" />
        <Alert tone="warning" title="Database not configured">
          Set DATABASE_URL and run the migrations.
        </Alert>
      </PageShell>
    );
  }

  const ai = await aiAvailability(user.id, 'assistant');

  let conversationId: string | null = null;
  let initialMessages: Awaited<ReturnType<typeof listMessages>> = [];
  if (ai.available) {
    const existing = await listConversations(user.id);
    conversationId = existing[0]?.id ?? (await createConversation(user.id));
    initialMessages = await listMessages(user.id, conversationId);
  }

  return (
    <PageShell>
      <PageHeader
        title="Assistant"
        description="Ask about your matches, applications, or resume score. It can only look things up — nothing it says results in an email, a submission, or a change to your data."
      />
      {!ai.available ? (
        <Alert tone="warning" title="No AI provider configured">
          {ai.reason} The rest of CareerPilot360 — ATS scoring, matching, application tracking — works fully without
          this.
        </Alert>
      ) : (
        <ChatView
          conversationId={conversationId!}
          initialMessages={initialMessages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolName: m.toolName,
            toolResult: m.toolResult,
          }))}
        />
      )}
    </PageShell>
  );
}
