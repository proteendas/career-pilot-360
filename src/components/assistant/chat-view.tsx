'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Search, Send, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { sendMessageAction, startConversationAction, type SentMessage } from '@/server/actions/assistant';
import { cn } from '@/lib/utils';

const TOOL_LABELS: Record<string, string> = {
  get_dashboard_summary: 'Checked your dashboard stats',
  list_job_matches: 'Looked up your job matches',
  list_applications: 'Looked up your applications',
  list_outreach_drafts: 'Looked up your outreach drafts',
};

const SUGGESTIONS = [
  'How is my resume scoring right now?',
  'What are my strongest job matches?',
  'Which applications need a follow-up?',
];

export function ChatView({
  conversationId,
  initialMessages,
}: {
  conversationId: string;
  initialMessages: SentMessage[];
}) {
  const router = useRouter();
  const [msgs, setMsgs] = React.useState(initialMessages);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [convId, setConvId] = React.useState(conversationId);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    const res = await sendMessageAction({ conversationId: convId, text });
    setSending(false);
    if (!res.ok || !res.data) {
      toast.error(res.error ?? 'Could not send that message.');
      setInput(text);
      return;
    }
    setMsgs((prev) => [...prev, ...res.data!.messages]);
  }

  async function newConversation() {
    const res = await startConversationAction();
    if (!res.ok || !res.data) {
      toast.error(res.error ?? 'Could not start a new conversation.');
      return;
    }
    setConvId(res.data.conversationId);
    setMsgs([]);
    router.refresh();
  }

  const visible = msgs.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool');

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-[28rem] flex-col">
      <div className="flex items-center justify-end pb-3">
        <Button size="sm" variant="ghost" onClick={() => void newConversation()}>
          New conversation
        </Button>
      </div>

      <Card className="flex flex-1 flex-col overflow-hidden">
        <CardContent className="flex-1 space-y-3 overflow-y-auto cp-scroll pt-5">
          {visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Bot className="size-5" aria-hidden />
              </span>
              <p className="text-sm text-ink-3">Ask about your matches, applications, or resume score.</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setInput(s)}
                    className="rounded-full border border-line-strong px-3 py-1 text-xs text-ink-3 transition-colors hover:border-accent hover:text-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            visible.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
          <div ref={bottomRef} />
        </CardContent>

        <div className="flex items-end gap-2 border-t border-line p-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask a question…"
            rows={1}
            maxLength={4000}
            className="min-h-10 resize-none"
          />
          <Button onClick={() => void send()} loading={sending} disabled={!input.trim()}>
            <Send aria-hidden />
            Send
          </Button>
        </div>
      </Card>
    </div>
  );
}

function MessageBubble({ message }: { message: SentMessage }) {
  if (message.role === 'tool') {
    return (
      <div className="flex items-center gap-2 pl-9 text-xs text-ink-4">
        <Search className="size-3" aria-hidden />
        {TOOL_LABELS[message.toolName ?? ''] ?? `Looked something up (${message.toolName})`}
      </div>
    );
  }

  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
          isUser ? 'bg-surface-2 text-ink-3' : 'bg-accent-soft text-accent',
        )}
      >
        {isUser ? <UserIcon className="size-3.5" aria-hidden /> : <Bot className="size-3.5" aria-hidden />}
      </span>
      <div
        className={cn(
          'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
          isUser ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2',
        )}
      >
        {message.content}
      </div>
    </div>
  );
}
