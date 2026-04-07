/** AI model configuration */

export const AI_CONFIG = {
  model: 'gpt-5.4-mini',
  temperature: 0,
  maxTokens: 400,
  timeoutMs: 8000,
} as const;

/**
 * OpenAI-compatible API endpoint.
 * Production builds use https://api.openai.com; local dev can override via VITE_OPENAI_API_URL.
 * User can also set a custom endpoint at runtime via the popup settings.
 */
export const OPENAI_API_URL =
  import.meta.env.VITE_OPENAI_API_URL ?? 'https://api.openai.com/v1/chat/completions';

/**
 * Default API key — empty in production builds.
 * Users must configure their own key via popup settings.
 * Only set via VITE_OPENAI_API_KEY in local dev for convenience.
 */
export const DEFAULT_API_KEY =
  import.meta.env.VITE_OPENAI_API_KEY ?? '';
