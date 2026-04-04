/**
 * Provider Proxy — injected into MAIN world via chrome.scripting
 * Wraps window.ethereum to intercept eth_sendTransaction & eth_signTypedData
 *
 * Security: Uses postMessage with a secret nonce to communicate with
 * content script. Page scripts cannot forge the nonce.
 */

const INTERCEPTED_METHODS = [
  'eth_sendTransaction',
  'eth_signTypedData_v4',
  'eth_signTypedData_v3',
  'eth_signTypedData',
] as const;

const DECISION_TIMEOUT_MS = 30_000;
const wrappedProviders = new WeakSet<object>();

function generateId(): string {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateNonce(): string {
  return crypto.getRandomValues(new Uint8Array(16)).reduce(
    (s, b) => s + b.toString(16).padStart(2, '0'), ''
  );
}

function isInterceptedMethod(method: string): boolean {
  return (INTERCEPTED_METHODS as readonly string[]).includes(method);
}

/** Session nonce — generated once, shared only via postMessage to content script */
const SESSION_NONCE = generateNonce();

interface ProviderLike {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function waitForDecision(txId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(true); // fail-open: let tx through if Guardian is unresponsive
    }, DECISION_TIMEOUT_MS);

    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (
        data?.type === 'guardian:decision' &&
        data?.nonce === SESSION_NONCE &&
        data?.id === txId
      ) {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        resolve(Boolean(data.approved));
      }
    };

    window.addEventListener('message', handler);
  });
}

function notifyContentScript(
  method: string,
  params: unknown[],
  id: string,
): void {
  window.postMessage(
    {
      type: 'guardian:intercept',
      nonce: SESSION_NONCE,
      payload: { method, params, id },
    },
    '*'
  );
}

function wrapProvider(provider: ProviderLike): void {
  if (wrappedProviders.has(provider)) return;
  wrappedProviders.add(provider);

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

function init(): void {
  if (window.ethereum) {
    wrapProvider(window.ethereum as ProviderLike);
  }

  const descriptor = Object.getOwnPropertyDescriptor(window, 'ethereum');
  if (!descriptor || descriptor.configurable) {
    let currentProvider = window.ethereum;
    Object.defineProperty(window, 'ethereum', {
      get: () => currentProvider,
      set: (newProvider) => {
        currentProvider = newProvider;
        if (newProvider) {
          wrapProvider(newProvider as ProviderLike);
        }
      },
      configurable: true,
    });
  }

  window.addEventListener('eip6963:announceProvider', (event: Event) => {
    const detail = (event as CustomEvent<{ provider: ProviderLike }>).detail;
    if (detail?.provider) {
      wrapProvider(detail.provider);
    }
  });

  console.log('[Guardian] Provider proxy initialized');
}

init();
