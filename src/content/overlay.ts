/**
 * Content Script — ISOLATED world
 * Listens for intercepted transactions via postMessage
 * Delegates card rendering to card-renderer.ts
 *
 * Security model:
 * - Receives intercept notifications from MAIN world via postMessage (read-only)
 * - Sends user decisions to service worker via chrome.runtime (internal channel)
 * - Service worker resolves the MAIN world promise via chrome.scripting.executeScript
 * - NO secrets are exchanged via postMessage — page scripts cannot forge decisions
 */

import type { AnalysisResult } from '@/types';
import { renderCard, updateCardWithAI } from './card-renderer';

// Ask the service worker to inject the MAIN-world proxy through chrome.scripting.
chrome.runtime.sendMessage({ type: 'ENSURE_PROVIDER_PROXY' }).catch(() => {});

let shadowRoot: ShadowRoot | null = null;

function getShadowRoot(): ShadowRoot {
  if (!shadowRoot) {
    const host = document.createElement('div');
    host.id = 'guardian-overlay-host';
    host.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'closed' });
  }
  return shadowRoot;
}

function sendDecision(txId: string, approved: boolean): void {
  chrome.runtime.sendMessage({
    type: 'RESOLVE_TX_DECISION',
    id: txId,
    approved,
  }).catch(() => {});
}

// Listen for intercepted transactions from MAIN world
window.addEventListener('message', async (event: MessageEvent) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (data?.type !== 'guardian:intercept') return;

  const payload = data.payload;
  if (
    !payload ||
    typeof payload.method !== 'string' ||
    !Array.isArray(payload.params) ||
    typeof payload.id !== 'string'
  ) return;

  const { method, params, id } = payload as {
    method: string; params: unknown[]; id: string;
  };

  let result: AnalysisResult | null;
  try {
    result = await chrome.runtime.sendMessage({
      type: 'ANALYZE_TRANSACTION',
      payload: { method, params, id },
    });
  } catch {
    result = {
      id, score: 50, tier: 1, riskLevel: 'yellow',
      summary: `Intercepted ${method}`,
      decoded: null, tokenFlow: null, aiExplanation: null,
    };
  }

  // Guardian disabled — let tx through without UI
  if (!result) {
    sendDecision(id, true);
    return;
  }

  renderCard(getShadowRoot(), result, (approved) => sendDecision(id, approved));

  // Fallback: if AI doesn't respond in 10s, show timeout message
  if (!result.aiExplanation) {
    const txId = id;
    setTimeout(() => {
      if (!shadowRoot) return;
      const card = shadowRoot.querySelector(`[data-guardian-tx-id="${txId}"]`);
      if (!card) return;
      const aiRow = card.querySelector('[data-guardian-ai]');
      if (aiRow && aiRow.textContent === 'AI analyzing...') {
        aiRow.textContent = 'AI analysis timed out — review manually.';
      }
    }, 10_000);
  }
});

// Handle Tier 2 AI updates + cleanup + dashboard queries
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_USER_ADDRESS') {
    const id = `addr-${Date.now()}`;
    window.postMessage({ type: 'guardian:getAddress', id }, window.location.origin);
    let responded = false;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'guardian:addressResult' && event.data?.id === id) {
        window.removeEventListener('message', handler);
        if (!responded) { responded = true; sendResponse({ address: event.data.address ?? null }); }
      }
    };
    window.addEventListener('message', handler);
    setTimeout(() => { window.removeEventListener('message', handler); if (!responded) { responded = true; sendResponse({ address: null }); } }, 3000);
    return true;
  }
  if (msg.type === 'SEND_REVOKE_TX' && msg.tx) {
    const id = `revoke-${Date.now()}`;
    window.postMessage({ type: 'guardian:sendTx', id, tx: msg.tx }, window.location.origin);
    let responded = false;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'guardian:txResult' && event.data?.id === id) {
        window.removeEventListener('message', handler);
        if (!responded) { responded = true; sendResponse({ success: event.data.success, error: event.data.error }); }
      }
    };
    window.addEventListener('message', handler);
    setTimeout(() => { window.removeEventListener('message', handler); if (!responded) { responded = true; sendResponse({ success: false, error: 'timeout' }); } }, 30000);
    return true;
  }
  if (msg.type === 'TIER2_UPDATE') {
    const p = msg.payload;
    if (!p || typeof p.id !== 'string' || typeof p.score !== 'number' || typeof p.explanation !== 'string') return;
    const riskFactors = Array.isArray(p.riskFactors) ? p.riskFactors.map(String) : [];
    updateCardWithAI(getShadowRoot(), p.id, p.score, p.explanation, riskFactors);
  }
  if (msg.type === 'CLEANUP') {
    document.getElementById('guardian-overlay-host')?.remove();
    shadowRoot = null;
  }
});

console.log('[Guardian] Content script loaded');
