/**
 * Background Service Worker — orchestrates Guardian analysis pipeline
 * Tier 1: fast local (tier1-analyzer.ts)
 * Tier 2: async AI with smart query strategy (query-strategy + context-fetcher)
 */

import type { AnalysisResult } from '@/types';
import { runTier1 } from '@/core/tier1-analyzer';
import { buildPrompt, type PromptContext } from '@/ai/prompt-builder';
import { callLLM, setApiKey } from '@/ai/llm-client';
import { buildCacheKey, getCached, setCache } from '@/ai/response-cache';
import { lookupContract } from '@/core/contract-db';
import { buildQueryPlan, extractTargetAddress } from '@/core/query-strategy';
import { fetchAllContext } from '@/core/context-fetcher';
import { computeTokenFlow } from '@/core/token-flow';
import { addTxRecord, updateTxDecision, updateTxAI, incrementScanned } from '@/core/tx-history';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  if (message.type === 'ANALYZE_TRANSACTION') {
    const p = message.payload;
    if (!p || typeof p.method !== 'string' || !Array.isArray(p.params) || typeof p.id !== 'string') {
      sendResponse(fallback('unknown'));
      return true;
    }
    handleAnalyze(p.id, p.method, p.params, sender.tab?.id)
      .then(sendResponse)
      .catch(() => sendResponse(fallback(p.id as string)));
    return true;
  }

  if (message.type === 'SET_API_KEY' && typeof message.key === 'string') {
    setApiKey(message.key).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'TX_DECISION') {
    const { id: txId, approved } = message as { id: string; approved: boolean };
    updateTxDecision(txId, approved ? 'approved' : 'rejected').then(() => {
      clearBadge();
      sendResponse({ ok: true });
    });
    return true;
  }
});

async function handleAnalyze(
  id: string,
  method: string,
  params: unknown[],
  tabId: number | undefined,
): Promise<AnalysisResult> {
  const result = await runTier1(id, method, params);

  const known = lookupContract(result.decoded?.contractAddress ?? '');
  if (known) {
    result.summary = `${result.decoded?.functionName ?? method} — ${known.name}`;
  }

  // Compute token flow — race with 2s timeout to not block Tier 1
  const ethValue = result.decoded?.value ?? '0x0';
  result.tokenFlow = await Promise.race([
    computeTokenFlow(result.decoded, ethValue).catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 2000)),
  ]);

  // Use query plan as single source of truth for whether to trigger AI
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

  // Persist to history + update stats
  await addTxRecord({
    id, timestamp: Date.now(), method,
    summary: result.summary,
    score: result.score,
    riskLevel: result.riskLevel,
    aiExplanation: result.aiExplanation,
    decision: 'pending',
    contractAddress: result.decoded?.contractAddress ?? '',
  });
  await incrementScanned(result.riskLevel === 'red');

  // Badge
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
    const cacheKey = buildCacheKey(contractAddr, method.slice(0, 10));
    const cached = getCached(cacheKey);

    if (cached) {
      pushUpdate(tabId, tier1.id, cached.score, cached.explanation, cached.risk_factors);
      return;
    }

    const spenderAddr = extractTargetAddress(tier1.decoded?.args ?? {});
    const userAddr = extractUserAddress(method, params);
    const { contract, threat, user } = await fetchAllContext(
      plan, contractAddr, spenderAddr, userAddr,
    );

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
    const response = await callLLM(system, userPrompt);

    if (response) {
      setCache(cacheKey, response);
      pushUpdate(tabId, tier1.id, response.score, response.explanation, response.risk_factors);
      await updateTxAI(tier1.id, response.score, response.explanation);
    }
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
    id, score: 50, tier: 1, riskLevel: 'yellow',
    summary: 'Analysis failed — proceed with caution',
    decoded: null, tokenFlow: null, aiExplanation: null,
  };
}

// Badge helpers
const BADGE_COLORS: Record<string, string> = {
  green: '#4ade80', yellow: '#facc15', red: '#f87171',
};

function setBadge(level: string): void {
  chrome.action.setBadgeText({ text: level === 'green' ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[level] ?? '#888' });
}

function clearBadge(): void {
  chrome.action.setBadgeText({ text: '' });
}

console.log('[Guardian] Service worker started');
