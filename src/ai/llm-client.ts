/**
 * Guardian API client — authenticated AI calls + local auth state cache
 */

import { GUARDIAN_API_URL } from '@/config/ai';

export interface LLMResponse {
  score: number;
  explanation: string;
  risk_factors: string[];
  action_suggestion: 'approve' | 'set_exact_amount' | 'review_carefully' | 'reject';
}

export interface GuardianUser {
  id: string;
  email: string;
  plan: 'free' | 'paid';
  createdAt: string;
}

export interface GuardianUsage {
  limit: number | null;
  used: number;
  remaining: number | null;
  resetAt: string;
  timezone: string;
}

export interface GuardianAuthState {
  status: 'guest' | 'authenticated';
  token: string | null;
  user: GuardianUser | null;
  usage: GuardianUsage | null;
  lastError: string | null;
}

export type LLMCallResult =
  | { status: 'ok'; response: LLMResponse; usage: GuardianUsage; cached: boolean }
  | { status: 'unauthenticated'; message: string }
  | { status: 'quota_exceeded'; message: string; usage: GuardianUsage | null }
  | { status: 'error'; message: string };

interface SessionResponse {
  token: string;
  user: GuardianUser;
  usage: GuardianUsage;
}

const AUTH_STORAGE_KEY = 'guardian_auth';

let authState: GuardianAuthState | null = null;

chrome.storage.onChanged.addListener((changes) => {
  if (changes[AUTH_STORAGE_KEY]) {
    authState = (changes[AUTH_STORAGE_KEY].newValue as GuardianAuthState | null) ?? null;
  }
});

function guestState(message: string | null = null): GuardianAuthState {
  return {
    status: 'guest',
    token: null,
    user: null,
    usage: null,
    lastError: message,
  };
}

function baseUrl(): string {
  return GUARDIAN_API_URL.replace(/\/+$/, '');
}

function apiUrl(path: string): string {
  return `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

async function saveAuthState(next: GuardianAuthState): Promise<GuardianAuthState> {
  authState = next;
  await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: next });
  return next;
}

export async function clearAuthState(): Promise<GuardianAuthState> {
  const next = guestState();
  authState = next;
  await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: next });
  return next;
}

export async function getAuthState(): Promise<GuardianAuthState> {
  if (authState) return authState;
  const result = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  authState = (result[AUTH_STORAGE_KEY] as GuardianAuthState | undefined) ?? guestState();
  return authState;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      data: text ? JSON.parse(text) as T : null,
    };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

async function persistSession(session: SessionResponse): Promise<GuardianAuthState> {
  return saveAuthState({
    status: 'authenticated',
    token: session.token,
    user: session.user,
    usage: session.usage,
    lastError: null,
  });
}

export async function registerAccount(email: string, password: string): Promise<{
  ok: boolean;
  auth: GuardianAuthState;
  error?: string;
}> {
  const response = await requestJson<SessionResponse & { error?: string }>(
    '/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    },
  );

  if (!response.ok || !response.data?.token || !response.data.user || !response.data.usage) {
    return {
      ok: false,
      auth: await getAuthState(),
      error: response.data?.error ?? 'Registration failed',
    };
  }

  return {
    ok: true,
    auth: await persistSession(response.data),
  };
}

export async function loginAccount(email: string, password: string): Promise<{
  ok: boolean;
  auth: GuardianAuthState;
  error?: string;
}> {
  const response = await requestJson<SessionResponse & { error?: string }>(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    },
  );

  if (!response.ok || !response.data?.token || !response.data.user || !response.data.usage) {
    return {
      ok: false,
      auth: await getAuthState(),
      error: response.data?.error ?? 'Login failed',
    };
  }

  return {
    ok: true,
    auth: await persistSession(response.data),
  };
}

export async function refreshAuthState(): Promise<GuardianAuthState> {
  const current = await getAuthState();
  if (!current.token) return current;

  const response = await requestJson<{ user?: GuardianUser; usage?: GuardianUsage; error?: string }>(
    '/me',
    { method: 'GET' },
    current.token,
  );

  if (!response.ok || !response.data?.user || !response.data?.usage) {
    if (response.status === 401) {
      return clearAuthState();
    }
    return saveAuthState({ ...current, lastError: response.data?.error ?? 'Failed to refresh account' });
  }

  return saveAuthState({
    status: 'authenticated',
    token: current.token,
    user: response.data.user,
    usage: response.data.usage,
    lastError: null,
  });
}

export async function refreshUsage(): Promise<GuardianAuthState> {
  const current = await getAuthState();
  if (!current.token || !current.user) return current;

  const response = await requestJson<{ usage?: GuardianUsage; error?: string }>(
    '/usage',
    { method: 'GET' },
    current.token,
  );

  if (!response.ok || !response.data?.usage) {
    if (response.status === 401) {
      return clearAuthState();
    }
    return saveAuthState({ ...current, lastError: response.data?.error ?? 'Failed to refresh usage' });
  }

  return saveAuthState({
    ...current,
    usage: response.data.usage,
    lastError: null,
  });
}

export async function logoutAccount(): Promise<GuardianAuthState> {
  return clearAuthState();
}

export async function callLLM(
  cacheKey: string,
  system: string,
  userPrompt: string,
): Promise<LLMCallResult> {
  const current = await getAuthState();
  if (!current.token) {
    return { status: 'unauthenticated', message: 'Sign in to unlock AI analysis.' };
  }

  const response = await requestJson<{
    analysis?: LLMResponse;
    usage?: GuardianUsage;
    error?: string;
    cached?: boolean;
  }>(
    '/analyze',
    {
      method: 'POST',
      body: JSON.stringify({ cacheKey, system, userPrompt }),
    },
    current.token,
  );

  if (response.ok && response.data?.analysis && response.data.usage) {
    await saveAuthState({
      ...current,
      status: 'authenticated',
      usage: response.data.usage,
      lastError: null,
    });
    return {
      status: 'ok',
      response: response.data.analysis,
      usage: response.data.usage,
      cached: Boolean(response.data.cached),
    };
  }

  if (response.status === 401) {
    await clearAuthState();
    return { status: 'unauthenticated', message: 'Your session expired. Sign in again to use AI.' };
  }

  if (response.status === 429) {
    await saveAuthState({
      ...current,
      usage: response.data?.usage ?? current.usage,
      lastError: response.data?.error ?? 'Daily AI limit reached',
    });
    return {
      status: 'quota_exceeded',
      message: response.data?.error ?? 'Daily AI limit reached',
      usage: response.data?.usage ?? current.usage,
    };
  }

  const message = response.data?.error ?? 'Guardian AI is temporarily unavailable.';
  await saveAuthState({ ...current, lastError: message });
  return { status: 'error', message };
}
