/**
 * Assistant conversations. Server-only.
 *
 * `sendMessage` is the whole loop: store the user's message, ask the model
 * (with the read-only tool allow-list from `src/lib/ai/tools.ts` attached),
 * execute any tool calls it makes, feed the results back, and repeat up to a
 * small cap. Every message — including each tool call and its result — is
 * persisted, so the conversation is a complete, auditable record of what was
 * looked up to produce an answer.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { conversations, getDb, messages, type Conversation, type Message } from '@/lib/db';
import { NotFoundError } from '@/lib/db/tenant';
import { generateText } from '@/lib/ai/client';
import { AiError } from '@/lib/ai/types';
import { ASSISTANT_PREAMBLE, SAFETY_PREAMBLE } from '@/lib/ai/prompts';
import { ASSISTANT_TOOLS, executeAssistantTool } from '@/lib/ai/tools';
import type { ChatMessage } from '@/lib/ai/types';

const MAX_TOOL_ROUNDS = 4;

export async function createConversation(userId: string, title = 'New conversation'): Promise<string> {
  const rows = await getDb().insert(conversations).values({ userId, title }).returning({ id: conversations.id });
  return rows[0]!.id;
}

export async function listConversations(userId: string): Promise<Conversation[]> {
  return getDb().select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt));
}

export interface ConversationSummary extends Conversation {
  /** The first thing the user asked, for a picker — every conversation's `title` is the same generic default. */
  preview: string | null;
}

/** Every past conversation, most recently active first, with a snippet to tell them apart in a history picker. */
export async function listConversationsWithPreview(userId: string): Promise<ConversationSummary[]> {
  const convos = await listConversations(userId);
  if (convos.length === 0) return [];

  const ids = convos.map((c) => c.id);
  const firstUserMessages = await getDb()
    .select({ conversationId: messages.conversationId, content: messages.content })
    .from(messages)
    .where(and(eq(messages.userId, userId), inArray(messages.conversationId, ids), eq(messages.role, 'user')))
    .orderBy(asc(messages.createdAt));

  const previewByConversation = new Map<string, string>();
  for (const m of firstUserMessages) {
    if (!previewByConversation.has(m.conversationId)) previewByConversation.set(m.conversationId, m.content);
  }

  return convos.map((c) => ({ ...c, preview: previewByConversation.get(c.id) ?? null }));
}

/** Delete a conversation and every message in it (cascades at the DB level). */
export async function deleteConversation(userId: string, conversationId: string): Promise<void> {
  await getConversation(userId, conversationId);
  await getDb().delete(conversations).where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId)));
}

export async function getConversation(userId: string, conversationId: string): Promise<Conversation> {
  const rows = await getDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('That conversation was not found.');
  return row;
}

export async function listMessages(userId: string, conversationId: string): Promise<Message[]> {
  await getConversation(userId, conversationId);
  return getDb()
    .select()
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.conversationId, conversationId)))
    .orderBy(asc(messages.createdAt));
}

async function insertMessage(input: {
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content?: string;
  toolName?: string;
  toolArguments?: unknown;
  toolResult?: unknown;
  provider?: string | null;
  model?: string | null;
  tokenUsage?: object;
  errorMessage?: string | null;
}): Promise<Message> {
  const rows = await getDb()
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      userId: input.userId,
      role: input.role,
      content: input.content ?? '',
      toolName: input.toolName ?? null,
      toolArguments: (input.toolArguments ?? null) as object | null,
      toolResult: (input.toolResult ?? null) as object | null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      tokenUsage: input.tokenUsage ?? {},
      errorMessage: input.errorMessage ?? null,
    })
    .returning();
  return rows[0]!;
}

/** Sends one user message, runs the tool loop, and returns every message created (user, tool*, assistant). */
export async function sendMessage(userId: string, conversationId: string, userText: string): Promise<Message[]> {
  await getConversation(userId, conversationId);
  const created: Message[] = [];

  const userMsg = await insertMessage({ conversationId, userId, role: 'user', content: userText });
  created.push(userMsg);

  // Only replay user/assistant turns from past exchanges. A 'tool' message
  // only makes sense paired with the assistant turn that declared it, in the
  // same round — replaying a past one without that pairing produces a
  // dangling tool-result message that strict providers (e.g. Groq's harmony
  // template) reject outright. The final assistant text already captures
  // whatever the tool call was worth remembering.
  const history = await listMessages(userId, conversationId);
  const chatHistory: ChatMessage[] = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as ChatMessage['role'], content: m.content }));

  const systemPrompt = [SAFETY_PREAMBLE, '', ASSISTANT_PREAMBLE].join('\n');
  const runMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...chatHistory];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await generateText({
        userId,
        task: 'assistant',
        messages: runMessages,
        tools: ASSISTANT_TOOLS,
        maxOutputTokens: 700,
        temperature: 0.3,
      });

      if (result.value.toolCalls.length === 0) {
        const assistantMsg = await insertMessage({
          conversationId,
          userId,
          role: 'assistant',
          content: result.value.text,
          provider: result.provider,
          model: result.model,
          tokenUsage: result.usage,
        });
        created.push(assistantMsg);
        await getDb().update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
        return created;
      }

      // Record the assistant's tool-call turn — with the actual calls attached,
      // so the adapter can serialize a transcript each provider's wire format
      // accepts — then run each tool and feed its result back by call id.
      runMessages.push({ role: 'assistant', content: result.value.text, toolCalls: result.value.toolCalls });
      for (const call of result.value.toolCalls) {
        let toolResult: unknown;
        let errorMessage: string | null = null;
        try {
          toolResult = await executeAssistantTool(call.name, call.arguments, userId);
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : 'Tool call failed.';
          toolResult = { error: errorMessage };
        }

        const toolMsg = await insertMessage({
          conversationId,
          userId,
          role: 'tool',
          toolName: call.name,
          toolArguments: call.arguments,
          toolResult,
          errorMessage,
        });
        created.push(toolMsg);
        runMessages.push({ role: 'tool', name: call.name, toolCallId: call.id, content: JSON.stringify(toolResult) });
      }
    }

    // Exhausted the tool-call budget without a final answer.
    const fallbackMsg = await insertMessage({
      conversationId,
      userId,
      role: 'assistant',
      content: "I looked a few things up but couldn't put together a final answer — try rephrasing your question.",
    });
    created.push(fallbackMsg);
    return created;
  } catch (err) {
    const message = err instanceof AiError ? err.message : 'The assistant is unavailable right now.';
    const errorMsg = await insertMessage({ conversationId, userId, role: 'assistant', content: message, errorMessage: message });
    created.push(errorMsg);
    return created;
  }
}
