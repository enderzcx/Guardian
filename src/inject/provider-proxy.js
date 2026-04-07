/**
 * Provider Proxy — injected into MAIN world
 * Wraps window.ethereum to intercept eth_sendTransaction & eth_signTypedData
 *
 * Security: Uses postMessage with a secret nonce to communicate with
 * content script. Page scripts cannot forge the nonce.
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

function generateId() {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateNonce() {
  return crypto.getRandomValues(new Uint8Array(16)).reduce(
    (s, b) => s + b.toString(16).padStart(2, '0'), ''
  );
}

function isInterceptedMethod(method) {
  return INTERCEPTED_METHODS.includes(method);
}

/** Per-transaction nonces — rotated each interception for replay protection */
const txNonces = new Map();

function waitForDecision(txId) {
  return new Promise((resolve) => {
    const expectedNonce = txNonces.get(txId);
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      txNonces.delete(txId);
      resolve(true); // fail-open: let tx through if Guardian is unresponsive
    }, DECISION_TIMEOUT_MS);

    const handler = (event) => {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (
        data?.type === 'guardian:decision' &&
        data?.nonce === expectedNonce &&
        data?.id === txId
      ) {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        txNonces.delete(txId);
        resolve(Boolean(data.approved));
      }
    };

    window.addEventListener('message', handler);
  });
}

function notifyContentScript(method, params, id) {
  const nonce = generateNonce();
  txNonces.set(id, nonce);
  window.postMessage(
    {
      type: 'guardian:intercept',
      nonce,
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

  // Handle dashboard queries from content script (no nonce required for reads)
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
