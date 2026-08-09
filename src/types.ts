export interface Env {
  AI: Ai;
  AI_SEARCH: AiSearchInstance;
  DB: D1Database;
  DEFAULT_MODEL: string;
  /** Compatibility fallback for direct web-search helper callers without a selected model. */
  WEB_SEARCH_MODEL?: string;
  /** Server-side Tavily live-search credential; never send this value to clients. */
  TAVILY_API_KEY?: string;
  /** Optional zero-setup Cloudflare Web Search binding (discovery only). */
  WEBSEARCH?: WebSearch;
  /** Base URL of a SearXNG-compatible JSON search endpoint. */
  SEARXNG_URL?: string;
  /** Optional bearer token for a protected SearXNG-compatible endpoint. */
  SEARXNG_API_KEY?: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** Server-side secret; never send this value to the dashboard browser. */
  CLOUDFLARE_USAGE_API_TOKEN?: string;
  /** Server-side NVIDIA API Catalog key; never send this value to clients. */
  NVIDIA_NIM_API_KEY?: string;
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
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type ToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string } };

export interface ChatCompletionRequest {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  /** Dashboard-only, explicit consent to retry a rejected Cloudflare request through NVIDIA. */
  allow_provider_fallback?: boolean;
  /** Legacy compatibility flag; model tool choice is the source of truth. */
  web_search?: boolean;
  /** Search the configured ai.lofuyu.com AI Search index instead of the public web. */
  site_search?: boolean;
  /** Optional result/fetch controls for web or site search. */
  web_search_options?: {
    max_num_results?: number;
    max_fetch_chars?: number;
    scope?: 'web' | 'site';
  } | null;
  /** OpenAI-compatible tool definitions are accepted for model tool calling. */
  tools?: ChatTool[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
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
