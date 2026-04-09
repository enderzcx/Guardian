/** AI model configuration */

export const AI_CONFIG = {
  model: 'gpt-5.4-mini',
  temperature: 0,
  maxTokens: 400,
  timeoutMs: 8000,
} as const;

/**
 * Guardian API endpoint.
 * Production builds should point at your hosted Guardian backend.
 */
export const GUARDIAN_API_URL =
  import.meta.env.VITE_GUARDIAN_API_URL ?? 'https://enderzcxai.duckdns.org/guardian';
