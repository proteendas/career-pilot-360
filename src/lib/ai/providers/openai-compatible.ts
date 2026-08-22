/**
 * OpenAI chat-completions adapter.
 *
 * Covers OpenAI, Groq, OpenRouter, Mistral, Azure OpenAI and any self-hosted
 * server speaking the same protocol — which is why this one file serves six
 * entries in the registry.
 *
 * Structured output uses `response_format: json_schema` where the provider
 * supports it, and degrades to a JSON-mode prompt when it does not. Either way
 * the result is validated with Zod before it is returned, so an unreliable
 * provider produces a clean error rather than bad data.
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

const DEFAULT_TIMEOUT_MS = 60_000;

interface ChatCompletionResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
  error?: { message?: string; type?: string; code?: string };
}

export class OpenAiCompatibleProvider implements AIProvider {
  readonly id: string;
  readonly name: string;
  private readonly def: ProviderDefinition;

  constructor(providerId: string) {
    const def = findProvider(providerId);
    if (!def) throw new AiError('unknown', `Unknown provider: ${providerId}`);
    this.def = def;
    this.id = def.id;
    this.name = def.name;
  }

  async models(): Promise<ModelInfo[]> {
    return this.def.models.map((m) => ({
      id: m.id,
      label: m.label,
      contextWindow: m.contextWindow,
      supportsStructuredOutput: m.supportsStructuredOutput,
      supportsTools: m.supportsTools,
      ...(m.freeTierAvailable === undefined ? {} : { freeTierAvailable: m.freeTierAvailable }),
    }));
  }

  private baseUrl(creds: ProviderCredentials): string {
    const url = (creds.baseUrl || this.def.defaultBaseUrl || '').replace(/\/+$/, '');
    if (!url) {
      throw new AiError('no_provider_configured', `${this.name} requires a base URL.`, { provider: this.id });
    }
    return url;
  }

  private headers(creds: ProviderCredentials): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${creds.apiKey}`,
    };
    // Azure authenticates with its own header instead of a bearer token.
    if (this.id === 'azure-openai') headers['api-key'] = creds.apiKey;
    // OpenRouter asks callers to identify themselves.
    if (this.id === 'openrouter') {
      headers['http-referer'] = 'https://careerpilot360.app';
      headers['x-title'] = 'CareerPilot360';
    }
    return headers;
  }

  private async post(
    creds: ProviderCredentials,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const url =
      this.id === 'azure-openai'
        ? `${this.baseUrl(creds)}/chat/completions?api-version=2024-10-21`
        : `${this.baseUrl(creds)}/chat/completions`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: this.headers(creds),
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AiError('timeout', `${this.name} did not respond in time.`, { provider: this.id });
      }
      throw new AiError('provider_unavailable', `Could not reach ${this.name}.`, { provider: this.id });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (!res.ok) throw await this.errorFor(res);

    try {
      return (await res.json()) as ChatCompletionResponse;
    } catch {
      throw new AiError('invalid_response', `${this.name} returned a response that was not JSON.`, {
        provider: this.id,
      });
    }
  }

  private async errorFor(res: Response): Promise<AiError> {
    let detail = '';
    try {
      const body = (await res.json()) as ChatCompletionResponse;
      detail = body.error?.message ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    const snippet = detail ? ` (${detail.slice(0, 200)})` : '';

    if (res.status === 401 || res.status === 403) {
      return new AiError('invalid_key', `${this.name} rejected the API key${snippet}`, { provider: this.id });
    }
    if (res.status === 429) {
      const quota = /quota|credit|billing|insufficient/i.test(detail);
      return new AiError(quota ? 'quota_exceeded' : 'rate_limited', `${this.name}: ${detail || 'rate limited'}`, {
        provider: this.id,
      });
    }
    if (res.status === 404) {
      return new AiError('model_not_found', `${this.name} does not have that model available${snippet}`, {
        provider: this.id,
      });
    }
    if (res.status === 400 && /context|token|too long|maximum/i.test(detail)) {
      return new AiError('context_too_long', `${this.name}: the input exceeded the model's context${snippet}`, {
        provider: this.id,
      });
    }
    if (res.status === 400 && /response_format|json_schema|schema/i.test(detail)) {
      return new AiError('structured_output_unsupported', `${this.name} rejected the structured-output request${snippet}`, {
        provider: this.id,
      });
    }
    if (res.status >= 500) {
      return new AiError('provider_unavailable', `${this.name} returned ${res.status}${snippet}`, { provider: this.id });
    }
    return new AiError('unknown', `${this.name} returned ${res.status}${snippet}`, { provider: this.id });
  }

  private usageOf(res: ChatCompletionResponse): TokenUsage {
    return {
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
      totalTokens:
        res.usage?.total_tokens ?? (res.usage?.prompt_tokens ?? 0) + (res.usage?.completion_tokens ?? 0),
    };
  }

  private resolveModel(requested: string | undefined, creds: ProviderCredentials): string {
    const model = requested || this.def.defaultModel;
    if (!model) {
      throw new AiError(
        'model_not_found',
        `${this.name} needs an explicit model. Set a default model for this provider in Settings.`,
        { provider: this.id },
      );
    }
    // Azure addresses the deployment through the URL, not the body.
    return this.id === 'azure-openai' && creds.baseUrl ? model : model;
  }

  async generateText(input: GenerateTextInput, creds: ProviderCredentials): Promise<GenerateTextResult> {
    const model = this.resolveModel(input.model, creds);

    const body: Record<string, unknown> = {
      model,
      messages: input.messages.map((m) =>
        m.role === 'tool'
          ? { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' }
          : m.role === 'assistant' && m.toolCalls?.length
            ? {
                role: 'assistant',
                content: m.content || null,
                tool_calls: m.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
                })),
              }
            : { role: m.role, content: m.content },
      ),
      temperature: input.temperature ?? 0.3,
      max_tokens: input.maxOutputTokens ?? 2048,
    };

    if (input.tools?.length) {
      body.tools = input.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }

    const res = await this.post(creds, body, input.signal);
    const choice = res.choices?.[0];

    return {
      text: choice?.message?.content ?? '',
      toolCalls: (choice?.message?.tool_calls ?? []).map((tc, i) => ({
        id: tc.id ?? `call_${i}`,
        name: tc.function?.name ?? '',
        arguments: safeJsonParse(tc.function?.arguments ?? '{}'),
      })),
      usage: this.usageOf(res),
      model: res.model ?? model,
      provider: this.id,
      finishReason: choice?.finish_reason ?? 'stop',
    };
  }

  async generateObject<T>(
    input: GenerateObjectInput<T>,
    creds: ProviderCredentials,
  ): Promise<GenerateObjectResult<T>> {
    const model = this.resolveModel(input.model, creds);
    const jsonSchema = toJsonSchema(input.schema);

    const baseBody: Record<string, unknown> = {
      model,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxOutputTokens ?? 4096,
    };

    // First choice: strict json_schema. Falls back to plain JSON mode, then to
    // extracting JSON from prose — each step degrades rather than failing.
    const attempts: Record<string, unknown>[] = [
      {
        ...baseBody,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: input.schemaName,
            ...(input.schemaDescription ? { description: input.schemaDescription } : {}),
            schema: jsonSchema,
            strict: false,
          },
        },
      },
      { ...baseBody, response_format: { type: 'json_object' } },
      baseBody,
    ];

    let lastError: AiError | null = null;

    for (const [index, body] of attempts.entries()) {
      try {
        const res = await this.post(creds, body, input.signal);
        const raw = res.choices?.[0]?.message?.content ?? '';
        const parsed = extractJson(raw);
        if (parsed === undefined) {
          lastError = new AiError('invalid_response', `${this.name} did not return JSON.`, { provider: this.id });
          continue;
        }

        const result = input.schema.safeParse(parsed);
        if (!result.success) {
          lastError = new AiError(
            'schema_validation_failed',
            `${this.name} returned data that did not match the expected shape: ` +
              z.prettifyError(result.error).slice(0, 300),
            { provider: this.id },
          );
          continue;
        }

        return {
          object: result.data,
          usage: this.usageOf(res),
          model: res.model ?? model,
          provider: this.id,
        };
      } catch (err) {
        if (err instanceof AiError) {
          lastError = err;
          // Only a structured-output rejection is worth downgrading for.
          const downgradable = err.code === 'structured_output_unsupported' || err.code === 'unknown';
          if (!downgradable || index === attempts.length - 1) throw err;
          continue;
        }
        throw err;
      }
    }

    throw lastError ?? new AiError('invalid_response', `${this.name} could not produce structured output.`, {
      provider: this.id,
    });
  }

  async embed(
    input: { values: string[]; model?: string; signal?: AbortSignal },
    creds: ProviderCredentials,
  ): Promise<number[][]> {
    if (!this.def.supportsEmbeddings) {
      throw new AiError('provider_unavailable', `${this.name} does not offer embeddings.`, { provider: this.id });
    }
    const res = await fetch(`${this.baseUrl(creds)}/embeddings`, {
      method: 'POST',
      headers: this.headers(creds),
      body: JSON.stringify({ model: input.model ?? 'text-embedding-3-small', input: input.values }),
      ...(input.signal ? { signal: input.signal } : {}),
      cache: 'no-store',
    });
    if (!res.ok) throw await this.errorFor(res);
    const body = (await res.json()) as { data?: { embedding?: number[] }[] };
    return (body.data ?? []).map((d) => d.embedding ?? []);
  }

  async validateKey(creds: ProviderCredentials): Promise<ProviderValidationResult> {
    if (!creds.apiKey?.trim()) return { valid: false, message: 'Enter an API key.' };
    if (this.def.requiresBaseUrl && !creds.baseUrl?.trim()) {
      return { valid: false, message: `${this.name} requires a base URL.` };
    }

    // A minimal completion is the only universally-supported liveness check:
    // several providers do not expose /models to all keys.
    try {
      const res = await this.generateText(
        {
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          maxOutputTokens: 5,
          temperature: 0,
        },
        creds,
      );
      return {
        valid: true,
        message: `Key works. Responded using ${res.model}.`,
        models: this.def.models.map((m) => m.id),
      };
    } catch (err) {
      if (err instanceof AiError) {
        return { valid: false, message: err.message };
      }
      return { valid: false, message: 'The key could not be validated.' };
    }
  }
}

/* -------------------------------------------------------------- utilities -- */

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/**
 * Pull a JSON value out of a model response.
 * Handles bare JSON, fenced code blocks, and JSON embedded in prose — all three
 * occur in practice, especially from smaller models.
 */
export function extractJson(raw: string): unknown {
  const text = (raw ?? '').trim();
  if (!text) return undefined;

  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }

  // Fall back to the outermost balanced object or array.
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start >= 0 && end > start) {
      const parsed = tryParse(text.slice(start, end + 1));
      if (parsed !== undefined) return parsed;
    }
  }

  return undefined;
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
