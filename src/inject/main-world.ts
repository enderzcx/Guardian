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

const w = window as MainWorldWindow;

const INTERCEPTED_METHODS = [
  'eth_sendTransaction',
  'eth_signTypedData_v4',
  'eth_signTypedData_v3',
  'eth_signTypedData',
];

const DECISION_TIMEOUT_MS = 30_000;

const state: MainWorldState = w.__guardianMainWorldState ?? {
  initialized: false,
  decisionEvent: `guardian:resolve:${crypto.randomUUID()}`,
  wrappedProviders: new WeakSet<object>(),
};
w.__guardianMainWorldState = state;

function announceReady(): void {
  window.postMessage({
    type: 'guardian:main-ready',
    payload: { decisionEvent: state.decisionEvent },
  }, window.location.origin);
}

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
      safeEvents.remove(state.decisionEvent, handler);
      resolve(Boolean(detail.approved));
    };

    const timeout = setTimeout(() => {
      safeEvents.remove(state.decisionEvent, handler);
      resolve(true);
    }, DECISION_TIMEOUT_MS);

    safeEvents.add(state.decisionEvent, handler);
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

function bindEthereumSlot(): void {
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
}

function bindProviderAnnouncements(): void {
  if (w.__guardianEip6963Bound) return;
  window.addEventListener('eip6963:announceProvider', (event: Event) => {
    const detail = (event as CustomEvent<{ provider?: ProviderLike }>).detail;
    if (detail?.provider) {
      wrapProvider(detail.provider);
    }
  });
  w.__guardianEip6963Bound = true;
}

function bindMessageBridge(): void {
  if (w.__guardianMessageBridgeBound) return;

  window.addEventListener('message', async (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const data = event.data;

    if (data?.type === 'guardian:handshake-request') {
      announceReady();
      return;
    }

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
      return;
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

if (!state.initialized) {
  state.initialized = true;
  bindEthereumSlot();
  bindProviderAnnouncements();
  bindMessageBridge();
}

announceReady();
