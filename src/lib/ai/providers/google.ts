/**
 * Google Gemini (generativelanguage) adapter.
 *
 * Protocol notes handled here:
 *  - the API key travels as a query parameter, not a bearer token;
 *  - messages are `contents` with `parts`, and the assistant role is "model";
 *  - the system prompt is `systemInstruction`;
 *  - structured output uses `responseMimeType` + `responseSchema`, which is a
 *    restricted subset of JSON Schema — `sanitiseSchema` strips what it rejects.
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
import { extractJson } from './openai-compatible';

const DEFAULT_TIMEOUT_MS = 60_000;

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; functionCall?: { name?: string; args?: unknown } }[] };
    finishReason?: string;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  modelVersion?: string;
  error?: { message?: string; status?: string };
}

/**
 * Gemini's `responseSchema` accepts only a subset of JSON Schema and errors on
 * anything else. Passing the raw schema through fails on ordinary constructs
 * like `additionalProperties`, so unsupported keywords are dropped.
 */
export function sanitiseSchema(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sanitiseSchema);
  if (!input || typeof input !== 'object') return input;

  const ALLOWED = new Set([
    'type', 'format', 'description', 'nullable', 'enum', 'items', 'properties',
    'required', 'minItems', 'maxItems', 'anyOf', 'title',
  ]);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
        props[pk] = sanitiseSchema(pv);
      }
      out[key] = props;
    } else if (key === 'items' || key === 'anyOf') {
      out[key] = sanitiseSchema(value);
    } else {
      out[key] = value;
    }
  }

  // Gemini requires a type on every node; default to object when we can infer it.
  if (!out.type && out.properties) out.type = 'object';
  return out;
}

export class GoogleProvider implements AIProvider {
  readonly id = 'google';
  readonly name = 'Google Gemini';
  private readonly def: ProviderDefinition;

  constructor() {
    const def = findProvider('google');
    if (!def) throw new AiError('unknown', 'Google is missing from the provider registry.');
    this.def = def;
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

  private async post(
    creds: ProviderCredentials,
    model: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<GeminiResponse> {
    const base = (creds.baseUrl || this.def.defaultBaseUrl).replace(/\/+$/, '');
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        // The key goes in a header rather than the query string so it cannot
        // leak into an intermediary's access log.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': creds.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AiError('timeout', 'Gemini did not respond in time.', { provider: this.id });
      }
      throw new AiError('provider_unavailable', 'Could not reach Gemini.', { provider: this.id });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (!res.ok) {
      let detail = '';
      try {
        detail = ((await res.json()) as GeminiResponse).error?.message ?? '';
      } catch {
        detail = await res.text().catch(() => '');
      }
      const snippet = detail ? ` (${detail.slice(0, 200)})` : '';

      if (res.status === 400 && /api key|api_key/i.test(detail)) {
        throw new AiError('invalid_key', `Gemini rejected the API key${snippet}`, { provider: this.id });
      }
      if (res.status === 401 || res.status === 403) {
        throw new AiError('invalid_key', `Gemini rejected the API key${snippet}`, { provider: this.id });
      }
      if (res.status === 429) {
        throw new AiError(/quota/i.test(detail) ? 'quota_exceeded' : 'rate_limited', `Gemini: ${detail || 'rate limited'}`, { provider: this.id });
      }
      if (res.status === 404) {
        throw new AiError('model_not_found', `Gemini does not have that model available${snippet}`, { provider: this.id });
      }
      if (res.status === 400 && /schema|responseSchema/i.test(detail)) {
        throw new AiError('structured_output_unsupported', `Gemini rejected the response schema${snippet}`, { provider: this.id });
      }
      if (res.status >= 500) {
        throw new AiError('provider_unavailable', `Gemini returned ${res.status}${snippet}`, { provider: this.id });
      }
      throw new AiError('unknown', `Gemini returned ${res.status}${snippet}`, { provider: this.id });
    }

    try {
      return (await res.json()) as GeminiResponse;
    } catch {
      throw new AiError('invalid_response', 'Gemini returned a response that was not JSON.', { provider: this.id });
    }
  }

  private usageOf(res: GeminiResponse): TokenUsage {
    const promptTokens = res.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = res.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: res.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens,
    };
  }

  private split(input: GenerateTextInput) {
    const systemInstruction = input.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    // Gemini's function-calling contract, unlike OpenAI's/Anthropic's, has no
    // live-tested provider in this codebase (no Google key exercised this
    // path) — this mapping follows Google's documented format but hasn't
    // been verified against a real response the way the openai-compatible
    // adapter's tool-call round trip has.
    const contents = input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            parts: [{ functionResponse: { name: m.name ?? '', response: extractJson(m.content) } }],
          };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'model',
            parts: m.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: tc.arguments ?? {} } })),
          };
        }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
      });

    return { systemInstruction, contents };
  }

  async generateText(input: GenerateTextInput, creds: ProviderCredentials): Promise<GenerateTextResult> {
    const model = input.model || this.def.defaultModel;
    const { systemInstruction, contents } = this.split(input);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: input.temperature ?? 0.3,
        maxOutputTokens: input.maxOutputTokens ?? 2048,
      },
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    };

    if (input.tools?.length) {
      body.tools = [
        {
          functionDeclarations: input.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: sanitiseSchema(t.parameters),
          })),
        },
      ];
    }

    const res = await this.post(creds, model, body, input.signal);
    const parts = res.candidates?.[0]?.content?.parts ?? [];

    return {
      text: parts.map((p) => p.text ?? '').join('').trim(),
      toolCalls: parts
        .filter((p) => p.functionCall)
        .map((p, i) => ({
          id: `call_${i}`,
          name: p.functionCall?.name ?? '',
          arguments: p.functionCall?.args ?? {},
        })),
      usage: this.usageOf(res),
      model: res.modelVersion ?? model,
      provider: this.id,
      finishReason: res.candidates?.[0]?.finishReason ?? 'STOP',
    };
  }

  async generateObject<T>(
    input: GenerateObjectInput<T>,
    creds: ProviderCredentials,
  ): Promise<GenerateObjectResult<T>> {
    const model = input.model || this.def.defaultModel;
    const { systemInstruction, contents } = this.split(input);
    const schema = sanitiseSchema(toJsonSchema(input.schema));

    const res = await this.post(
      creds,
      model,
      {
        contents,
        generationConfig: {
          temperature: input.temperature ?? 0.2,
          maxOutputTokens: input.maxOutputTokens ?? 4096,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      },
      input.signal,
    );

    const raw = (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const parsedJson = extractJson(raw);
    if (parsedJson === undefined) {
      throw new AiError('invalid_response', 'Gemini did not return JSON.', { provider: this.id });
    }

    const result = input.schema.safeParse(parsedJson);
    if (!result.success) {
      throw new AiError(
        'schema_validation_failed',
        `Gemini returned data that did not match the expected shape: ${z.prettifyError(result.error).slice(0, 300)}`,
        { provider: this.id },
      );
    }

    return { object: result.data, usage: this.usageOf(res), model: res.modelVersion ?? model, provider: this.id };
  }

  async embed(
    input: { values: string[]; model?: string; signal?: AbortSignal },
    creds: ProviderCredentials,
  ): Promise<number[][]> {
    const base = (creds.baseUrl || this.def.defaultBaseUrl).replace(/\/+$/, '');
    const model = input.model ?? 'text-embedding-004';
    const out: number[][] = [];

    for (const value of input.values) {
      const res = await fetch(`${base}/models/${encodeURIComponent(model)}:embedContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': creds.apiKey },
        body: JSON.stringify({ content: { parts: [{ text: value }] } }),
        ...(input.signal ? { signal: input.signal } : {}),
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new AiError('provider_unavailable', `Gemini embeddings returned ${res.status}.`, { provider: this.id });
      }
      const body = (await res.json()) as { embedding?: { values?: number[] } };
      out.push(body.embedding?.values ?? []);
    }
    return out;
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
