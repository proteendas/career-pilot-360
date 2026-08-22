/**
 * Anthropic Messages API adapter.
 *
 * Two protocol differences from the OpenAI shape are handled here:
 *  - the system prompt is a top-level field, not a message;
 *  - structured output is obtained by forcing a single tool call whose input
 *    schema IS the requested schema, which is the reliable way to get
 *    schema-shaped JSON out of this API.
 */
import { z } from 'zod';
import {
  AiError,
  type AIProvider,
  type GenerateObjectInput,
  type GenerateObjectResult,
  type GenerateTextInput,
  type GenerateTextResult,
  type ModelInfo,
  type ProviderCredentials,
  type ProviderValidationResult,
  type TokenUsage,
} from '../types';
import { findProvider, type ProviderDefinition } from '../registry';
import { toJsonSchema } from '../json-schema';

const API_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 60_000;

interface AnthropicResponse {
  content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
  stop_reason?: string;
  error?: { type?: string; message?: string };
}

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  private readonly def: ProviderDefinition;

  constructor() {
    const def = findProvider('anthropic');
    if (!def) throw new AiError('unknown', 'Anthropic is missing from the provider registry.');
    this.def = def;
  }

  async models(): Promise<ModelInfo[]> {
    return this.def.models.map((m) => ({
      id: m.id,
      label: m.label,
      contextWindow: m.contextWindow,
      supportsStructuredOutput: m.supportsStructuredOutput,
      supportsTools: m.supportsTools,
    }));
  }

  private async post(
    creds: ProviderCredentials,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AnthropicResponse> {
    const base = (creds.baseUrl || this.def.defaultBaseUrl).replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    let res: Response;
    try {
      res = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': creds.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AiError('timeout', 'Anthropic did not respond in time.', { provider: this.id });
      }
      throw new AiError('provider_unavailable', 'Could not reach Anthropic.', { provider: this.id });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (!res.ok) {
      let detail = '';
      try {
        detail = ((await res.json()) as AnthropicResponse).error?.message ?? '';
      } catch {
        detail = await res.text().catch(() => '');
      }
      const snippet = detail ? ` (${detail.slice(0, 200)})` : '';

      if (res.status === 401 || res.status === 403) {
        throw new AiError('invalid_key', `Anthropic rejected the API key${snippet}`, { provider: this.id });
      }
      if (res.status === 429) {
        throw new AiError(/credit|quota|billing/i.test(detail) ? 'quota_exceeded' : 'rate_limited', `Anthropic: ${detail || 'rate limited'}`, { provider: this.id });
      }
      if (res.status === 404) {
        throw new AiError('model_not_found', `Anthropic does not have that model available${snippet}`, { provider: this.id });
      }
      if (res.status === 400 && /token|context|too long|max_tokens/i.test(detail)) {
        throw new AiError('context_too_long', `Anthropic: input exceeded the model's context${snippet}`, { provider: this.id });
      }
      if (res.status >= 500) {
        throw new AiError('provider_unavailable', `Anthropic returned ${res.status}${snippet}`, { provider: this.id });
      }
      throw new AiError('unknown', `Anthropic returned ${res.status}${snippet}`, { provider: this.id });
    }

    try {
      return (await res.json()) as AnthropicResponse;
    } catch {
      throw new AiError('invalid_response', 'Anthropic returned a response that was not JSON.', { provider: this.id });
    }
  }

  private usageOf(res: AnthropicResponse): TokenUsage {
    const promptTokens = res.usage?.input_tokens ?? 0;
    const completionTokens = res.usage?.output_tokens ?? 0;
    return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
  }

  /** Anthropic takes the system prompt separately from the message list. */
  private split(input: GenerateTextInput) {
    const system = input.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const messages = input.messages
      .filter((m) => m.role !== 'system')
      .map((m) =>
        m.role === 'tool'
          ? {
              role: 'user' as const,
              content: [
                { type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content },
              ],
            }
          : m.role === 'assistant' && m.toolCalls?.length
            ? {
                role: 'assistant' as const,
                content: [
                  ...(m.content ? [{ type: 'text', text: m.content }] : []),
                  ...m.toolCalls.map((tc) => ({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments ?? {} })),
                ],
              }
            : { role: m.role as 'user' | 'assistant', content: m.content },
      );

    return { system, messages };
  }

  async generateText(input: GenerateTextInput, creds: ProviderCredentials): Promise<GenerateTextResult> {
    const model = input.model || this.def.defaultModel;
    const { system, messages } = this.split(input);

    const body: Record<string, unknown> = {
      model,
      max_tokens: input.maxOutputTokens ?? 2048,
      temperature: input.temperature ?? 0.3,
      messages,
      ...(system ? { system } : {}),
    };

    if (input.tools?.length) {
      body.tools = input.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const res = await this.post(creds, body, input.signal);
    const blocks = res.content ?? [];

    return {
      text: blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim(),
      toolCalls: blocks
        .filter((b) => b.type === 'tool_use')
        .map((b, i) => ({ id: b.id ?? `call_${i}`, name: b.name ?? '', arguments: b.input ?? {} })),
      usage: this.usageOf(res),
      model: res.model ?? model,
      provider: this.id,
      finishReason: res.stop_reason ?? 'stop',
    };
  }

  async generateObject<T>(
    input: GenerateObjectInput<T>,
    creds: ProviderCredentials,
  ): Promise<GenerateObjectResult<T>> {
    const model = input.model || this.def.defaultModel;
    const { system, messages } = this.split(input);
    const schema = toJsonSchema(input.schema);

    // Forcing a tool call is how this API returns schema-shaped JSON reliably.
    const res = await this.post(
      creds,
      {
        model,
        max_tokens: input.maxOutputTokens ?? 4096,
        temperature: input.temperature ?? 0.2,
        messages,
        ...(system ? { system } : {}),
        tools: [
          {
            name: input.schemaName,
            description: input.schemaDescription ?? 'Return the result in this exact shape.',
            input_schema: schema,
          },
        ],
        tool_choice: { type: 'tool', name: input.schemaName },
      },
      input.signal,
    );

    const toolUse = (res.content ?? []).find((b) => b.type === 'tool_use');
    if (!toolUse) {
      throw new AiError('invalid_response', 'Anthropic did not return the requested structure.', {
        provider: this.id,
      });
    }

    const parsed = input.schema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new AiError(
        'schema_validation_failed',
        `Anthropic returned data that did not match the expected shape: ${z.prettifyError(parsed.error).slice(0, 300)}`,
        { provider: this.id },
      );
    }

    return { object: parsed.data, usage: this.usageOf(res), model: res.model ?? model, provider: this.id };
  }

  async validateKey(creds: ProviderCredentials): Promise<ProviderValidationResult> {
    if (!creds.apiKey?.trim()) return { valid: false, message: 'Enter an API key.' };
    try {
      const res = await this.generateText(
        { messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxOutputTokens: 8, temperature: 0 },
        creds,
      );
      return { valid: true, message: `Key works. Responded using ${res.model}.`, models: this.def.models.map((m) => m.id) };
    } catch (err) {
      return { valid: false, message: err instanceof AiError ? err.message : 'The key could not be validated.' };
    }
  }
}
