/** AI model configuration */

export const AI_CONFIG = {
  model: 'gpt-5.4-mini',
  temperature: 0,
  maxTokens: 400,
  timeoutMs: 8000,
} as const;

/** OpenAI-compatible API endpoint — override via .env.local: VITE_OPENAI_API_URL */
export const OPENAI_API_URL =
  import.meta.env.VITE_OPENAI_API_URL ?? 'https://api.openai.com/v1/chat/completions';

/** API key — override via .env.local: VITE_OPENAI_API_KEY */
export const DEFAULT_API_KEY =
  import.meta.env.VITE_OPENAI_API_KEY ?? '';
