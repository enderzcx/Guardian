/** AI model configuration */

export const AI_CONFIG = {
  model: 'gpt-5.4-mini',
  temperature: 0,
  maxTokens: 400,
  timeoutMs: 8000,
} as const;

/** OpenAI-compatible API endpoint (Codex proxy) */
export const OPENAI_API_URL = 'http://43.159.171.118:8080/v1/chat/completions';

/** Default API key for Codex proxy */
export const DEFAULT_API_KEY = 'pwd';
