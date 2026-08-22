/**
 * The provider catalogue.
 *
 * A note on "free": several providers offer a free tier at the time of writing,
 * and `freeTierToday` records that. It is deliberately named to make clear it
 * is a point-in-time observation, not a promise — pricing and free tiers are
 * the provider's to change, and the UI says so wherever this is displayed.
 */

export type ProviderId =
  | 'groq'
  | 'google'
  | 'openrouter'
  | 'mistral'
  | 'openai'
  | 'anthropic'
  | 'azure-openai'
  | 'openai-compatible';

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'google';

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  /** Which adapter implements the wire protocol. */
  kind: ProviderKind;
  defaultBaseUrl: string;
  /** Whether the user must supply a base URL (self-hosted / Azure). */
  requiresBaseUrl: boolean;
  freeTierToday: boolean;
  tier: 'low_cost' | 'premium';
  keyFormatHint: string;
  consoleUrl: string;
  description: string;
  defaultModel: string;
  models: {
    id: string;
    label: string;
    contextWindow: number;
    supportsStructuredOutput: boolean;
    supportsTools: boolean;
    freeTierAvailable?: boolean;
  }[];
  supportsEmbeddings: boolean;
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    requiresBaseUrl: false,
    freeTierToday: true,
    tier: 'low_cost',
    keyFormatHint: 'Starts with gsk_',
    consoleUrl: 'https://console.groq.com/keys',
    description: 'Very fast inference with a free developer tier. A good default for resume and matching tasks.',
    // Verified live against Groq's /models endpoint — Groq retires models on
    // a rolling basis (llama-3.3-70b-versatile and llama-3.1-8b-instant,
    // this registry's previous entries, are both gone as of this check).
    // Re-verify here before assuming any Groq model id still resolves.
    defaultModel: 'openai/gpt-oss-120b',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', contextWindow: 131_072, supportsStructuredOutput: true, supportsTools: true, freeTierAvailable: true },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (fast)', contextWindow: 131_072, supportsStructuredOutput: true, supportsTools: true, freeTierAvailable: true },
      { id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B', contextWindow: 131_072, supportsStructuredOutput: false, supportsTools: true, freeTierAvailable: true },
    ],
    supportsEmbeddings: false,
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresBaseUrl: false,
    freeTierToday: true,
    tier: 'low_cost',
    keyFormatHint: 'Starts with AIza',
    consoleUrl: 'https://aistudio.google.com/apikey',
    description: 'Large context windows and a free tier on several models. Strong at long-document work.',
    defaultModel: 'gemini-2.0-flash',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', contextWindow: 1_000_000, supportsStructuredOutput: true, supportsTools: true, freeTierAvailable: true },
      { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', contextWindow: 1_000_000, supportsStructuredOutput: true, supportsTools: true, freeTierAvailable: true },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', contextWindow: 1_000_000, supportsStructuredOutput: true, supportsTools: true },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', contextWindow: 1_000_000, supportsStructuredOutput: true, supportsTools: true },
    ],
    supportsEmbeddings: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresBaseUrl: false,
    freeTierToday: true,
    tier: 'low_cost',
    keyFormatHint: 'Starts with sk-or-',
    consoleUrl: 'https://openrouter.ai/keys',
    description: 'One key, many models, including several free ones. Useful as a fallback provider.',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', contextWindow: 128_000, supportsStructuredOutput: true, supportsTools: true },
      { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', contextWindow: 1_000_000, supportsStructuredOutput: true, supportsTools: true },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', contextWindow: 64_000, supportsStructuredOutput: true, supportsTools: true },
      { id: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B', contextWindow: 32_000, supportsStructuredOutput: true, supportsTools: false },
    ],
    supportsEmbeddings: false,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    requiresBaseUrl: false,
    freeTierToday: true,
    tier: 'low_cost',
    keyFormatHint: '32-character alphanumeric key',
    consoleUrl: 'https://console.mistral.ai/api-keys',
    description: 'European provider with a free experimental tier and solid instruction following.',
    defaultModel: 'mistral-large-latest',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large', contextWindow: 128_000, supportsStructuredOutput: true, supportsTools: true },
      { id: 'mistral-small-latest', label: 'Mistral Small', contextWindow: 128_000, supportsStructuredOutput: true, supportsTools: true, freeTierAvailable: true },
      { id: 'open-mistral-nemo', label: 'Mistral Nemo', contextWindow: 128_000, supportsStructuredOutput: true, supportsTools: true, freeTierAvailable: true },
    ],
    supportsEmbeddings: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresBaseUrl: false,
    freeTierToday: false,
    tier: 'premium',
    keyFormatHint: 'Starts with sk-',
    consoleUrl: 'https://platform.openai.com/api-keys',
    description: 'Paid per token. Reliable structured output and tool calling.',
    defaultModel: 'gpt-4.1-mini',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1', contextWindow: 1_000_000, supportsStructuredOutput: true, supportsTools: true },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', contextWindow: 1_000_000, supportsStructuredOutput: true, supportsTools: true },
      { id: 'gpt-4o', label: 'GPT-4o', contextWindow: 128_000, supportsStructuredOutput: true, supportsTools: true },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', contextWindow: 128_000, supportsStructuredOutput: true, supportsTools: true },
    ],
    supportsEmbeddings: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    requiresBaseUrl: false,
    freeTierToday: false,
    tier: 'premium',
    keyFormatHint: 'Starts with sk-ant-',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Paid per token. Strong at careful, instruction-following writing tasks.',
    defaultModel: 'claude-sonnet-4-5',
    models: [
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', contextWindow: 200_000, supportsStructuredOutput: true, supportsTools: true },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', contextWindow: 200_000, supportsStructuredOutput: true, supportsTools: true },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', contextWindow: 200_000, supportsStructuredOutput: true, supportsTools: true },
    ],
    supportsEmbeddings: false,
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    kind: 'openai-compatible',
    defaultBaseUrl: '',
    requiresBaseUrl: true,
    freeTierToday: false,
    tier: 'premium',
    keyFormatHint: 'Azure resource key',
    consoleUrl: 'https://portal.azure.com',
    description:
      'Your own Azure deployment. Set the base URL to ' +
      'https://<resource>.openai.azure.com/openai/deployments/<deployment> and use the deployment name as the model.',
    defaultModel: '',
    models: [],
    supportsEmbeddings: true,
  },
  {
    id: 'openai-compatible',
    name: 'Other OpenAI-compatible endpoint',
    kind: 'openai-compatible',
    defaultBaseUrl: '',
    requiresBaseUrl: true,
    freeTierToday: true,
    tier: 'low_cost',
    keyFormatHint: 'Whatever your endpoint expects',
    consoleUrl: '',
    description:
      'Any server exposing the OpenAI chat-completions API — Together, Fireworks, DeepInfra, vLLM, ' +
      'Ollama or LM Studio on a public URL.',
    defaultModel: '',
    models: [],
    supportsEmbeddings: false,
  },
];

export function findProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function isProviderId(id: string): id is ProviderId {
  return PROVIDERS.some((p) => p.id === id);
}

/** Providers grouped for the settings UI. */
export function providersByTier() {
  return {
    low_cost: PROVIDERS.filter((p) => p.tier === 'low_cost'),
    premium: PROVIDERS.filter((p) => p.tier === 'premium'),
  };
}

/**
 * Ordering used when a task has no explicit provider preference.
 * Cheap-and-fast first, so a user with several keys is not billed premium rates
 * for a routine resume pass.
 */
export const DEFAULT_PROVIDER_PRIORITY: ProviderId[] = [
  'groq',
  'google',
  'mistral',
  'openrouter',
  'openai',
  'anthropic',
  'azure-openai',
  'openai-compatible',
];
