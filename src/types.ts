export interface Env {
  AI: Ai;
  AI_SEARCH: AiSearchInstance;
  DB: D1Database;
  DEFAULT_MODEL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** Server-side secret; never send this value to the dashboard browser. */
  CLOUDFLARE_USAGE_API_TOKEN?: string;
}

/** Identity resolved from a Cloudflare Access JWT. */
export interface AccessIdentity {
  email: string;
  sub: string;
  /** Access application audience tag this token was issued for. */
  aud: string;
}

/** A stored API key row (never contains the plaintext secret). */
export interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  owner_email: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  request_count: number;
  total_tokens: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content: string | null;
  name?: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  /** Cloudflare AI Search is invoked only when this extension is true. */
  web_search?: boolean;
  /** Optional controls for an enabled web search request. */
  web_search_options?: { max_num_results?: number } | null;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
  stop?: string | string[];
  n?: number;
  user?: string;
}

export interface EmbeddingsRequest {
  model?: string;
  input?: string | string[];
  encoding_format?: 'float' | 'base64';
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
