/**
 * Provider Proxy — injected into MAIN world
 * Wraps window.ethereum to intercept eth_sendTransaction & eth_signTypedData
 *
 * Security model:
 * - Intercept notifications go OUT via postMessage (read-only, no secrets)
 * - Decision resolution comes IN via chrome.scripting.executeScript calling
 *   window.__guardianResolve(). Only the extension can call executeScript,
 *   so page scripts cannot forge approvals.
 *
 * NOTE: This file must be plain JS (not TS) because it's loaded as
 * a web_accessible_resource without going through the TS compiler.
 */

const INTERCEPTED_METHODS = [
  'eth_sendTransaction',
  'eth_signTypedData_v4',
  'eth_signTypedData_v3',
  'eth_signTypedData',
];

const DECISION_TIMEOUT_MS = 30000;
const wrappedProviders = new WeakSet();

/** Map<txId, { resolve: Function, timeout: number }> */
const pendingDecisions = new Map();

function generateId() {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isInterceptedMethod(method) {
  return INTERCEPTED_METHODS.includes(method);
}

/**
 * Called by the extension via chrome.scripting.executeScript.
 * Page scripts CANNOT call chrome.scripting, so this is unforgeable.
 */
window.__guardianResolve = function (txId, approved) {
  const pending = pendingDecisions.get(txId);
  if (!pending) return false;
  clearTimeout(pending.timeout);
  pendingDecisions.delete(txId);
  pending.resolve(Boolean(approved));
  return true;
};

function waitForDecision(txId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingDecisions.delete(txId);
      resolve(true); // fail-open: let tx through if Guardian is unresponsive
    }, DECISION_TIMEOUT_MS);

    pendingDecisions.set(txId, { resolve, timeout });
  });
}

function notifyContentScript(method, params, id) {
  // Only sends the intercept notification — no secrets, no tokens.
  // The decision will come via __guardianResolve, not postMessage.
  window.postMessage(
    {
      type: 'guardian:intercept',
      payload: { method, params, id },
    },
    window.location.origin
  );
}

function wrapProvider(provider) {
  if (wrappedProviders.has(provider)) return;
  wrappedProviders.add(provider);

  const originalRequest = provider.request.bind(provider);

  provider.request = async (args) => {
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

function init() {
  if (window.ethereum) {
    wrapProvider(window.ethereum);
  }

  const descriptor = Object.getOwnPropertyDescriptor(window, 'ethereum');
  if (!descriptor || descriptor.configurable) {
    let currentProvider = window.ethereum;
    Object.defineProperty(window, 'ethereum', {
      get: () => currentProvider,
      set: (newProvider) => {
        currentProvider = newProvider;
        if (newProvider) {
          wrapProvider(newProvider);
        }
      },
      configurable: true,
    });
  }

  window.addEventListener('eip6963:announceProvider', (event) => {
    if (event.detail?.provider) {
      wrapProvider(event.detail.provider);
    }
  });

  // Handle dashboard queries from content script (read-only, no security concern)
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const data = event.data;

    if (data?.type === 'guardian:getAddress' && data.id) {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
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
        await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [data.tx],
        });
        window.postMessage({ type: 'guardian:txResult', id: data.id, success: true }, window.location.origin);
      } catch (e) {
        window.postMessage({ type: 'guardian:txResult', id: data.id, success: false, error: e.message }, window.location.origin);
      }
    }
  });

  console.log('[Guardian] Provider proxy initialized');
}

init();
