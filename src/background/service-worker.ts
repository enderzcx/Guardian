/**
 * Background Service Worker - orchestrates Guardian analysis pipeline
 * Tier 1: fast local (tier1-analyzer.ts)
 * Tier 2: async AI with smart query strategy (query-strategy + context-fetcher)
 */

import type { AnalysisResult } from '@/types';
import { runTier1 } from '@/core/tier1-analyzer';
import { buildPrompt, type PromptContext } from '@/ai/prompt-builder';
import {
  callLLM,
  loginAccount,
  logoutAccount,
  refreshAuthState,
  refreshUsage,
  registerAccount,
} from '@/ai/llm-client';
import { buildCacheKey, getCached, setCache } from '@/ai/response-cache';
import { lookupContract } from '@/core/contract-db';
import { buildQueryPlan, extractTargetAddress } from '@/core/query-strategy';
import { fetchAllContext } from '@/core/context-fetcher';
import { computeTokenFlow } from '@/core/token-flow';
import { addTxRecord, updateTxDecision, updateTxAI, incrementScanned } from '@/core/tx-history';
import { scanApprovals, clearApprovalCache } from '@/core/approval-scanner';
import { buildRevokeTx } from '@/core/revoke-tx';

interface ProviderLike {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface MainWorldState {
  initialized: boolean;
  decisionEvent: string;
  wrappedProviders: WeakSet<object>;
}

type MainWorldWindow = Window & typeof globalThis & {
  ethereum?: ProviderLike;
  __guardianMainWorldState?: MainWorldState;
  __guardianEip6963Bound?: boolean;
  __guardianMessageBridgeBound?: boolean;
};

/** Last known dapp tab with a wallet - used by dashboard */
let lastDappTabId: number | undefined;
const decisionEventByTab = new Map<number, string>();

function getDecisionEventName(tabId: number): string {
  const existing = decisionEventByTab.get(tabId);
  if (existing) return existing;
  const generated = `guardian:resolve:${crypto.randomUUID()}`;
  decisionEventByTab.set(tabId, generated);
  return generated;
}

async function ensureProviderProxy(tabId: number): Promise<void> {
  const decisionEventName = getDecisionEventName(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [decisionEventName],
    func: (decisionEvent: string) => {
      const w = window as MainWorldWindow;
      if (w.__guardianMainWorldState?.initialized && w.__guardianMainWorldState.decisionEvent === decisionEvent) {
        return;
      }

      const INTERCEPTED_METHODS = [
        'eth_sendTransaction',
        'eth_signTypedData_v4',
        'eth_signTypedData_v3',
        'eth_signTypedData',
      ];
      const DECISION_TIMEOUT_MS = 30_000;
      const state: MainWorldState = w.__guardianMainWorldState ?? {
        initialized: false,
        decisionEvent,
        wrappedProviders: new WeakSet<object>(),
      };
      state.initialized = true;
      state.decisionEvent = decisionEvent;
      w.__guardianMainWorldState = state;

      function getSafeEventApis(): {
        add: (type: string, listener: EventListenerOrEventListenerObject) => void;
        remove: (type: string, listener: EventListenerOrEventListenerObject) => void;
      } {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        (document.documentElement ?? document.body)?.appendChild(iframe);
        const safeWindow = iframe.contentWindow as (Window & typeof globalThis) | null;
        const SafeEventTarget = safeWindow?.EventTarget;
        const add = SafeEventTarget
          ? SafeEventTarget.prototype.addEventListener.bind(window) as (type: string, listener: EventListenerOrEventListenerObject) => void
          : window.addEventListener.bind(window);
        const remove = SafeEventTarget
          ? SafeEventTarget.prototype.removeEventListener.bind(window) as (type: string, listener: EventListenerOrEventListenerObject) => void
          : window.removeEventListener.bind(window);
        iframe.remove();
        return { add, remove };
      }

      const safeEvents = getSafeEventApis();

      function generateId(): string {
        return `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }

      function isInterceptedMethod(method: string): boolean {
        return INTERCEPTED_METHODS.includes(method);
      }

      function waitForDecision(txId: string): Promise<boolean> {
        return new Promise((resolve) => {
          const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ txId?: string; approved?: boolean }>).detail;
            if (detail?.txId !== txId) return;
            clearTimeout(timeout);
            safeEvents.remove(decisionEvent, handler);
            resolve(Boolean(detail.approved));
          };

          const timeout = setTimeout(() => {
            safeEvents.remove(decisionEvent, handler);
            resolve(true);
          }, DECISION_TIMEOUT_MS);

          safeEvents.add(decisionEvent, handler);
        });
      }

      function notifyContentScript(method: string, params: unknown[], id: string): void {
        window.postMessage(
          { type: 'guardian:intercept', payload: { method, params, id } },
          window.location.origin,
        );
      }

      function wrapProvider(provider: ProviderLike): void {
        if (state.wrappedProviders.has(provider)) return;
        state.wrappedProviders.add(provider);

        const originalRequest = provider.request.bind(provider);
        provider.request = async (args: { method: string; params?: unknown[] }) => {
          if (!isInterceptedMethod(args.method)) {
            return originalRequest(args);
          }

          const txId = generateId();
          notifyContentScript(args.method, args.params ?? [], txId);

          const approved = await waitForDecision(txId);
          if (!approved) {
            throw new Error('Guardian: Transaction rejected by user');
          }

          return originalRequest(args);
        };
      }

      if (w.ethereum) {
        wrapProvider(w.ethereum);
      }

      const descriptor = Object.getOwnPropertyDescriptor(window, 'ethereum');
      if (!descriptor || descriptor.configurable) {
        let currentProvider = w.ethereum;
        Object.defineProperty(window, 'ethereum', {
          get: () => currentProvider,
          set: (newProvider) => {
            currentProvider = newProvider as ProviderLike | undefined;
            if (currentProvider) {
              wrapProvider(currentProvider);
            }
          },
          configurable: true,
        });
      }

      if (!w.__guardianEip6963Bound) {
        window.addEventListener('eip6963:announceProvider', (event: Event) => {
          const detail = (event as CustomEvent<{ provider?: ProviderLike }>).detail;
          if (detail?.provider) {
            wrapProvider(detail.provider);
          }
        });
        w.__guardianEip6963Bound = true;
      }

      if (!w.__guardianMessageBridgeBound) {
        window.addEventListener('message', async (event: MessageEvent) => {
          if (event.source !== window) return;
          if (event.origin !== window.location.origin) return;
          const data = event.data;

          if (data?.type === 'guardian:getAddress' && data.id) {
            try {
              const accounts = await w.ethereum?.request({ method: 'eth_accounts' }) as string[] | undefined;
              window.postMessage({
                type: 'guardian:addressResult',
                id: data.id,
                address: accounts?.[0] ?? null,
              }, window.location.origin);
            } catch {
              window.postMessage({ type: 'guardian:addressResult', id: data.id, address: null }, window.location.origin);
            }
          }

          if (data?.type === 'guardian:sendTx' && data.id && data.tx) {
            try {
              await w.ethereum?.request({
                method: 'eth_sendTransaction',
                params: [data.tx],
              });
              window.postMessage({ type: 'guardian:txResult', id: data.id, success: true }, window.location.origin);
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error';
              window.postMessage({ type: 'guardian:txResult', id: data.id, success: false, error: message }, window.location.origin);
            }
          }
        });
        w.__guardianMessageBridgeBound = true;
      }
    },
  });
}

async function resolveTxDecision(tabId: number, txId: string, approved: boolean): Promise<void> {
  const decisionEventName = getDecisionEventName(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [decisionEventName, txId, approved],
    func: (decisionEvent: string, id: string, ok: boolean) => {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      (document.documentElement ?? document.body)?.appendChild(iframe);
      const safeWindow = iframe.contentWindow as (Window & typeof globalThis) | null;
      const SafeEventTarget = safeWindow?.EventTarget;
      const dispatch = SafeEventTarget
        ? SafeEventTarget.prototype.dispatchEvent.bind(window)
        : window.dispatchEvent.bind(window);
      const SafeCustomEvent = safeWindow?.CustomEvent ?? CustomEvent;
      dispatch(new SafeCustomEvent(decisionEvent, {
        detail: { txId: id, approved: ok },
      }));
      iframe.remove();
    },
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (sender.tab?.id !== undefined) lastDappTabId = sender.tab.id;

  if (message.type === 'ENSURE_PROVIDER_PROXY') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      sendResponse({ ok: false });
      return true;
    }
    ensureProviderProxy(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'ANALYZE_TRANSACTION') {
    const p = message.payload;
    if (!p || typeof p.method !== 'string' || !Array.isArray(p.params) || typeof p.id !== 'string') {
      sendResponse(fallback('unknown'));
      return true;
    }
    isGuardianEnabled().then((enabled) => {
      if (!enabled) {
        sendResponse(null);
        return;
      }
      handleAnalyze(p.id, p.method, p.params, sender.tab?.id)
        .then(sendResponse)
        .catch(() => sendResponse(fallback(p.id as string)));
    });
    return true;
  }

  if (message.type === 'AUTH_REGISTER' && typeof message.email === 'string' && typeof message.password === 'string') {
    registerAccount(message.email, message.password).then(sendResponse);
    return true;
  }

  if (message.type === 'AUTH_LOGIN' && typeof message.email === 'string' && typeof message.password === 'string') {
    loginAccount(message.email, message.password).then(sendResponse);
    return true;
  }

  if (message.type === 'AUTH_LOGOUT') {
    logoutAccount().then((auth) => sendResponse({ ok: true, auth }));
    return true;
  }

  if (message.type === 'GET_AUTH_STATE') {
    refreshAuthState().then((auth) => sendResponse({ ok: true, auth }));
    return true;
  }

  if (message.type === 'REFRESH_AUTH_STATE') {
    refreshUsage().then((auth) => sendResponse({ ok: true, auth }));
    return true;
  }

  if (message.type === 'SCAN_APPROVALS') {
    getDappTabAddress().then(async (addr) => {
      if (!addr) {
        sendResponse({ error: 'Connect your wallet on a dApp first, then scan.', approvals: [], address: '' });
        return;
      }
      const approvals = await scanApprovals(addr);
      sendResponse({ approvals, address: addr });
    }).catch(() => sendResponse({ error: 'Scan failed', approvals: [], address: '' }));
    return true;
  }

  if (message.type === 'REVOKE_APPROVAL' && message.approval) {
    getDappTabAddress().then(async (addr) => {
      if (!addr || lastDappTabId === undefined) {
        sendResponse({ ok: false, error: 'No dApp tab' });
        return;
      }
      const tx = buildRevokeTx(message.approval, addr);
      chrome.tabs.sendMessage(lastDappTabId, { type: 'SEND_REVOKE_TX', tx }, (response) => {
        if (response?.success) {
          clearApprovalCache();
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: response?.error ?? 'Revoke failed or rejected' });
        }
      });
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/index.html') });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'RESOLVE_TX_DECISION') {
    const { id: txId, approved } = message as { id: string; approved: boolean };
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      sendResponse({ ok: false });
      return true;
    }

    resolveTxDecision(tabId, txId, approved)
      .then(() => updateTxDecision(txId, approved ? 'approved' : 'rejected'))
      .then(() => {
        clearBadge();
        sendResponse({ ok: true });
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

async function handleAnalyze(
  id: string,
  method: string,
  params: unknown[],
  tabId: number | undefined,
): Promise<AnalysisResult> {
  const activeTabId = tabId ?? lastDappTabId;
  if (activeTabId !== undefined) {
    await ensureProviderProxy(activeTabId).catch(() => {});
  }
  const result = await runTier1(id, method, params);

  const known = lookupContract(result.decoded?.contractAddress ?? '');
  if (known) {
    result.summary = `${result.decoded?.functionName ?? method} - ${known.name}`;
  }

  const ethValue = result.decoded?.value ?? '0x0';
  result.tokenFlow = await Promise.race([
    computeTokenFlow(result.decoded, ethValue).catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 2000)),
  ]);

  const spenderAddr = extractTargetAddress(result.decoded?.args ?? {});
  const plan = buildQueryPlan(
    result.decoded?.contractAddress ?? '',
    spenderAddr,
    result.decoded?.functionName ?? '',
    method,
  );

  if (plan.callAI) {
    triggerTier2(result, method, params, plan, tabId);
  } else {
    result.aiExplanation = known
      ? `Verified operation on ${known.name}. ${plan.reason}`
      : `Routine transaction. ${plan.reason}`;
  }

  await addTxRecord({
    id,
    timestamp: Date.now(),
    method,
    summary: result.summary,
    score: result.score,
    riskLevel: result.riskLevel,
    aiExplanation: result.aiExplanation,
    decision: 'pending',
    contractAddress: result.decoded?.contractAddress ?? '',
  });
  await incrementScanned(result.riskLevel === 'red');

  setBadge(result.riskLevel);
  return result;
}

async function triggerTier2(
  tier1: AnalysisResult,
  method: string,
  params: unknown[],
  plan: import('@/core/query-strategy').QueryPlan,
  tabId: number | undefined,
): Promise<void> {
  try {
    const contractAddr = tier1.decoded?.contractAddress ?? '';
    const args = tier1.decoded?.args ?? {};
    const selector = tier1.decoded?.selector
      ?? `${tier1.decoded?.functionName ?? method}:${args.spender ?? ''}:${args.amount ?? ''}`;
    const cacheKey = buildCacheKey(contractAddr, selector);
    const cached = getCached(cacheKey);

    if (cached) {
      pushUpdate(tabId, tier1.id, cached.score, cached.explanation, cached.risk_factors);
      await updateTxAI(tier1.id, cached.score, cached.explanation);
      setBadge(cached.score <= 30 ? 'green' : cached.score <= 70 ? 'yellow' : 'red');
      return;
    }

    const spenderAddr = extractTargetAddress(tier1.decoded?.args ?? {});
    const userAddr = extractUserAddress(method, params);
    const { contract, threat, user } = await fetchAllContext(plan, contractAddr, spenderAddr, userAddr);

    const ctx: PromptContext = {
      method,
      decoded: tier1.decoded,
      tokenFlow: tier1.tokenFlow,
      contract,
      threat,
      user,
      locale: 'en',
    };

    const { system, user: userPrompt } = buildPrompt(ctx);
    const response = await callLLM(cacheKey, system, userPrompt);

    if (response.status === 'ok') {
      setCache(cacheKey, response.response);
      pushUpdate(tabId, tier1.id, response.response.score, response.response.explanation, response.response.risk_factors);
      await updateTxAI(tier1.id, response.response.score, response.response.explanation);
      const newLevel = response.response.score <= 30 ? 'green' : response.response.score <= 70 ? 'yellow' : 'red';
      setBadge(newLevel);
      return;
    }

    const fallbackExplanation = response.status === 'unauthenticated'
      ? 'Sign in to unlock AI analysis.'
      : response.status === 'quota_exceeded'
        ? 'Daily AI limit reached. Free users get 10 AI analyses per day.'
        : response.message;
    pushUpdate(tabId, tier1.id, tier1.score, fallbackExplanation, []);
    await updateTxAI(tier1.id, tier1.score, fallbackExplanation);
  } catch (error) {
    console.error('[Guardian] Tier 2 failed:', error);
  }
}

function extractUserAddress(method: string, params: unknown[]): string | null {
  if (method.startsWith('eth_signTypedData')) {
    return typeof params[0] === 'string' ? params[0] : null;
  }
  const tx = params[0] as Record<string, string> | undefined;
  return tx?.from ?? null;
}

function pushUpdate(
  tabId: number | undefined,
  txId: string,
  score: number,
  explanation: string,
  riskFactors: string[],
): void {
  if (tabId === undefined) return;
  chrome.tabs.sendMessage(tabId, {
    type: 'TIER2_UPDATE',
    payload: { id: txId, score, explanation, riskFactors },
  }).catch(() => {});
}

function fallback(id: string): AnalysisResult {
  return {
    id,
    score: 50,
    tier: 1,
    riskLevel: 'yellow',
    summary: 'Analysis failed - proceed with caution',
    decoded: null,
    tokenFlow: null,
    aiExplanation: null,
  };
}

const BADGE_COLORS: Record<string, string> = {
  green: '#4ade80',
  yellow: '#facc15',
  red: '#f87171',
};

function setBadge(level: string): void {
  chrome.action.setBadgeText({ text: level === 'green' ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[level] ?? '#888' });
}

function clearBadge(): void {
  chrome.action.setBadgeText({ text: '' });
}

async function getDappTabAddress(): Promise<string | null> {
  if (lastDappTabId === undefined) return null;
  try {
    const response = await chrome.tabs.sendMessage(lastDappTabId, { type: 'GET_USER_ADDRESS' });
    return response?.address ?? null;
  } catch {
    return null;
  }
}

async function isGuardianEnabled(): Promise<boolean> {
  const result = await chrome.storage.local.get('guardian_enabled');
  return result.guardian_enabled !== false;
}

console.log('[Guardian] Service worker started');
refreshAuthState().catch(() => {});
