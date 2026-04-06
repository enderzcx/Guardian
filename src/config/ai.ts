/** AI model configuration */

export const AI_CONFIG = {
  model: 'gpt-5.4-mini',
  temperature: 0,
  maxTokens: 400,
  timeoutMs: 8000,
} as const;

/** OpenAI-compatible API endpoint — set via chrome.storage or env */
export const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/** API key placeholder — user provides their own key in settings */
export const DEFAULT_API_KEY = '';
