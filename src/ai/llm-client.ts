/**
 * LLM Client — calls GPT-5.4-mini for transaction analysis
 * Handles API calls, single retry with backoff, and response parsing
 */

import { AI_CONFIG, OPENAI_API_URL, DEFAULT_API_KEY } from '@/config/ai';

export interface LLMResponse {
  score: number;
  explanation: string;
  risk_factors: string[];
  action_suggestion: 'approve' | 'set_exact_amount' | 'review_carefully' | 'reject';
}

let apiKey: string | null = null;
let apiUrl: string | null = null;

// Invalidate cached values when storage changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.openai_api_key) {
    apiKey = (changes.openai_api_key.newValue as string) ?? null;
  }
  if (changes.openai_api_url) {
    apiUrl = (changes.openai_api_url.newValue as string) ?? null;
  }
});

export async function getApiKey(): Promise<string | null> {
  if (apiKey) return apiKey;
  const result = await chrome.storage.local.get('openai_api_key');
  apiKey = (result.openai_api_key as string) ?? DEFAULT_API_KEY;
  return apiKey || null;
}

async function getApiUrl(): Promise<string> {
  if (apiUrl) return apiUrl;
  const result = await chrome.storage.local.get('openai_api_url');
  apiUrl = (result.openai_api_url as string) ?? OPENAI_API_URL;
  return apiUrl;
}

export async function setApiKey(key: string): Promise<void> {
  apiKey = key;
  await chrome.storage.local.set({ openai_api_key: key });
}

export async function setApiUrl(url: string): Promise<void> {
  apiUrl = url;
  await chrome.storage.local.set({ openai_api_url: url });
}

export async function callLLM(
  system: string,
  user: string,
): Promise<LLMResponse | null> {
  const key = await getApiKey();
  if (!key) {
    console.warn('[Guardian] No OpenAI API key configured');
    return null;
  }

  // Try once, retry once on transient failure
  const result = await attemptCall(key, system, user);
  if (result !== null) return result;

  // Single retry after 1s backoff
  await new Promise((r) => setTimeout(r, 1000));
  return attemptCall(key, system, user);
}

async function attemptCall(
  key: string,
  system: string,
  user: string,
): Promise<LLMResponse | null> {
  try {
    const url = await getApiUrl();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        temperature: AI_CONFIG.temperature,
        max_tokens: AI_CONFIG.maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(AI_CONFIG.timeoutMs),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => 'unknown');
      console.error(`[Guardian] LLM API error ${response.status}: ${err}`);
      // Don't retry on 401/403 (auth errors)
      if (response.status === 401 || response.status === 403) return null;
      return null;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[Guardian] Unexpected API response shape');
      return null;
    }

    return parseResponse(content);
  } catch (error) {
    console.error('[Guardian] LLM call failed:', error);
    return null;
  }
}

function parseResponse(raw: string): LLMResponse | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const score = Number(parsed.score);
    if (isNaN(score) || score < 0 || score > 100) return null;

    const explanation = String(parsed.explanation ?? '');
    if (!explanation) return null;

    const riskFactors = Array.isArray(parsed.risk_factors)
      ? parsed.risk_factors.map(String).slice(0, 5)
      : [];

    const validActions = ['approve', 'set_exact_amount', 'review_carefully', 'reject'] as const;
    const action = validActions.includes(parsed.action_suggestion as typeof validActions[number])
      ? (parsed.action_suggestion as LLMResponse['action_suggestion'])
      : 'review_carefully';

    return { score: Math.round(score), explanation, risk_factors: riskFactors, action_suggestion: action };
  } catch (error) {
    console.debug('[Guardian] LLM response parse failed:', error);
    return null;
  }
}
