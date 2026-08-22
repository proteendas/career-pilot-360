'use server';

/**
 * Assistant server actions. `sendMessageAction` is the only one that talks
 * to the AI — everything it can do is read-only, see `src/lib/ai/tools.ts`.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit';
import { NotFoundError } from '@/lib/db/tenant';
import { createConversation, sendMessage } from '@/lib/assistant/service';

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  notice?: string;
  data?: T;
}

function toResult(err: unknown): ActionResult<never> {
  if (err instanceof RateLimitError) {
    return { ok: false, error: `Too many messages. Try again in ${err.retryAfterSeconds}s.` };
  }
  if (err instanceof NotFoundError) return { ok: false, error: err.message };
  console.error('[assistant-action] unexpected failure', err);
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

export async function startConversationAction(): Promise<ActionResult<{ conversationId: string }>> {
  try {
    const user = await requireUser();
    const conversationId = await createConversation(user.id);
    revalidatePath('/assistant');
    return { ok: true, data: { conversationId } };
  } catch (err) {
    return toResult(err);
  }
}

const sendSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1, 'Type a message first.').max(4000),
});

export interface SentMessage {
  id: string;
  role: string;
  content: string;
  toolName: string | null;
  toolResult: unknown;
}

export async function sendMessageAction(raw: unknown): Promise<ActionResult<{ messages: SentMessage[] }>> {
  try {
    const user = await requireUser();
    const parsed = sendSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Type a message first.' };

    await enforceRateLimit('assistantMessage', user.id);

    const created = await sendMessage(user.id, parsed.data.conversationId, parsed.data.text);
    revalidatePath('/assistant');
    return {
      ok: true,
      data: {
        messages: created.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolName: m.toolName,
          toolResult: m.toolResult,
        })),
      },
    };
  } catch (err) {
    return toResult(err);
  }
}
