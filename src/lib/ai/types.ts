/**
 * Provider-neutral AI interface.
 *
 * Deliberately implemented against each provider's HTTP API rather than a
 * vendor SDK stack. Three reasons:
 *   - one dependency surface instead of six, and no SDK version drift;
 *   - structured output and fallback behave identically across providers,
 *     because we own the shape;
 *   - mocking in tests is a `fetch` stub, not a nest of SDK internals.
 *
 * Every provider adapter is a thin translation layer. Nothing above this
 * interface knows which provider is in use.
 */
import type { z } from 'zod';

export type AiTask =
  | 'resume_analysis'
  | 'resume_suggestions'
  | 'resume_tailoring'
  | 'job_matching'
  | 'cover_letter'
  | 'screening_answers'
  | 'outreach_draft'
  | 'assistant'
  | 'job_extraction';

export const AI_TASKS: AiTask[] = [
  'resume_analysis',
  'resume_suggestions',
  'resume_tailoring',
  'job_matching',
  'cover_letter',
  'screening_answers',
  'outreach_draft',
  'assistant',
  'job_extraction',
];

export const AI_TASK_LABELS: Record<AiTask, string> = {
  resume_analysis: 'Resume analysis',
  resume_suggestions: 'Resume suggestions',
  resume_tailoring: 'Resume tailoring',
  job_matching: 'Job match explanation',
  cover_letter: 'Cover letters',
  screening_answers: 'Screening answers',
  outreach_draft: 'Outreach drafts',
  assistant: 'Assistant chat',
  job_extraction: 'Job description extraction',
};

export interface ModelInfo {
  id: string;
  label: string;
  /** Rough context window in tokens, for input budgeting. */
  contextWindow: number;
  supportsStructuredOutput: boolean;
  supportsTools: boolean;
  /** Set when the provider advertises a free tier for this model TODAY. */
  freeTierAvailable?: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on tool result messages. */
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments. Always validated again with Zod after. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw arguments as returned by the model, before Zod validation. */
  arguments: unknown;
}

export interface GenerateTextInput {
  messages: ChatMessage[];
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  /** Abort signal so a slow provider cannot hold a serverless function open. */
  signal?: AbortSignal;
}

export interface GenerateTextResult {
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  model: string;
  provider: string;
  finishReason: string;
}

export interface GenerateObjectInput<T> extends Omit<GenerateTextInput, 'tools'> {
  schema: z.ZodType<T>;
  /** Name for the schema, used by providers that require one. */
  schemaName: string;
  schemaDescription?: string;
}

export interface GenerateObjectResult<T> {
  object: T;
  usage: TokenUsage;
  model: string;
  provider: string;
}

export interface EmbeddingInput {
  values: string[];
  model?: string;
  signal?: AbortSignal;
}

export interface ProviderValidationResult {
  valid: boolean;
  message: string;
  /** Models the key can actually reach, when the provider will say. */
  models?: string[];
}

export interface ProviderCredentials {
  apiKey: string;
  /** For OpenAI-compatible and Azure deployments. */
  baseUrl?: string;
}

/**
 * The interface every provider adapter implements.
 * `embed` is optional: several providers do not offer embeddings, and nothing
 * in CareerPilot360 requires them — matching is lexical and deterministic.
 */
export interface AIProvider {
  readonly id: string;
  readonly name: string;
  models(): Promise<ModelInfo[]>;
  generateText(input: GenerateTextInput, creds: ProviderCredentials): Promise<GenerateTextResult>;
  generateObject<T>(input: GenerateObjectInput<T>, creds: ProviderCredentials): Promise<GenerateObjectResult<T>>;
  embed?(input: EmbeddingInput, creds: ProviderCredentials): Promise<number[][]>;
  validateKey(creds: ProviderCredentials): Promise<ProviderValidationResult>;
}

/* ------------------------------------------------------------------ errors */

export type AiErrorCode =
  | 'no_provider_configured'
  | 'invalid_key'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'model_not_found'
  | 'context_too_long'
  | 'structured_output_unsupported'
  | 'timeout'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'schema_validation_failed'
  | 'token_limit_reached'
  | 'task_disabled'
  | 'unknown';

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly provider: string | null;
  /** True when retrying with a different provider could plausibly work. */
  readonly retryable: boolean;

  constructor(
    code: AiErrorCode,
    message: string,
    opts: { provider?: string | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.provider = opts.provider ?? null;
    this.retryable = opts.retryable ?? RETRYABLE_CODES.has(code);
  }
}

const RETRYABLE_CODES = new Set<AiErrorCode>([
  'rate_limited',
  'quota_exceeded',
  'timeout',
  'provider_unavailable',
  'model_not_found',
  'structured_output_unsupported',
]);

/** User-facing explanation for each failure mode. */
export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  no_provider_configured:
    'No AI provider is configured. Add a provider key in Settings → AI providers, or continue without AI — the deterministic analysis works either way.',
  invalid_key: 'That provider rejected the API key. Check it in Settings → AI providers.',
  rate_limited: 'The provider is rate-limiting requests. Wait a moment and try again.',
  quota_exceeded: 'The provider reports the quota for this key is exhausted.',
  model_not_found: 'That model is not available to this key. Pick a different model.',
  context_too_long: 'The input was too long for this model. Try a shorter resume section or a larger-context model.',
  structured_output_unsupported: 'This model cannot return structured output reliably.',
  timeout: 'The provider took too long to respond.',
  provider_unavailable: 'The provider could not be reached.',
  invalid_response: 'The provider returned a response that could not be read.',
  schema_validation_failed: 'The model returned data that did not match the expected shape.',
  token_limit_reached: 'You have reached the monthly token limit you set for this provider.',
  task_disabled: 'AI is disabled for this task in your settings.',
  unknown: 'The AI request failed for an unexpected reason.',
};

export function emptyUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}
