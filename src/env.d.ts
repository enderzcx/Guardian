/// <reference types="vite/client" />
/// <reference types="@types/chrome" />

declare interface Window {
  /** Injected by provider-proxy.js — resolves pending tx decisions from MAIN world */
  __guardianResolve?: (txId: string, approved: boolean) => boolean;
}
