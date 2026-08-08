const CHAT_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct-fp8',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/meta/llama-3.2-1b-instruct',
  '@cf/meta/llama-3.2-11b-vision-instruct',
  '@cf/openai/gpt-oss-120b',
  '@cf/openai/gpt-oss-20b',
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
  '@cf/qwen/qwq-32b',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/zai-org/glm-4.7-flash',
  '@cf/zai-org/glm-5.2',
  '@cf/moonshotai/kimi-k2.6',
  '@cf/moonshotai/kimi-k2.7-code',
  '@cf/nvidia/nemotron-3-120b-a12b',
  '@cf/ibm-granite/granite-4.0-h-micro',
  '@cf/aisingapore/gemma-sea-lion-v4-27b-it',
];

const EMBEDDING_MODELS = [
  '@cf/baai/bge-base-en-v1.5',
  '@cf/baai/bge-large-en-v1.5',
  '@cf/baai/bge-small-en-v1.5',
  '@cf/baai/bge-m3',
  '@cf/google/embeddinggemma-300m',
  '@cf/qwen/qwen3-embedding-0.6b',
  '@cf/pfnet/plamo-embedding-1b',
];

export const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

// These aliases preserve the normal OpenAI SDK experience while inference is
// still executed by the existing Workers AI binding.
const OPENAI_ALIASES: Record<string, string> = {
  'gpt-4o': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  'gpt-4o-mini': '@cf/meta/llama-3.1-8b-instruct-fp8',
  'gpt-4.1': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  'gpt-4.1-mini': '@cf/meta/llama-3.1-8b-instruct-fp8',
  'gpt-5': '@cf/openai/gpt-oss-120b',
  'gpt-5-mini': '@cf/openai/gpt-oss-20b',
  'o3-mini': '@cf/openai/gpt-oss-20b',
};

function modelPayload(id: string): Record<string, unknown> {
  return { id, object: 'model', created: 1_700_000_000, owned_by: 'cloudflare' };
}

export function modelListPayload(): { object: 'list'; data: Array<Record<string, unknown>> } {
  return {
    object: 'list',
    data: [...CHAT_MODELS, ...EMBEDDING_MODELS].map(modelPayload),
  };
}

export function resolveChatModel(input: string | undefined, fallback: string): string | null {
  const requested = input?.trim() || fallback.trim();
  if (CHAT_MODELS.includes(requested)) return requested;

  const alias = OPENAI_ALIASES[requested.toLowerCase()];
  if (alias) return alias;

  // Some SDKs send a dated OpenAI model identifier. Keep those requests
  // compatible without accepting arbitrary names as Workers AI IDs.
  if (/^(gpt|o)[-_]/i.test(requested) && CHAT_MODELS.includes(fallback.trim())) return fallback.trim();
  return null;
}

export function resolveEmbeddingModel(input: string | undefined): string | null {
  const requested = input?.trim();
  if (!requested) return DEFAULT_EMBEDDING_MODEL;
  return EMBEDDING_MODELS.includes(requested) ? requested : null;
}
