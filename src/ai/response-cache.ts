/**
 * Response Cache — caches AI responses by contract + method signature
 * Same contract calling the same function → reuse explanation template
 */

import type { LLMResponse } from './llm-client';

interface CacheEntry {
  response: LLMResponse;
  timestamp: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CACHE_MAX_SIZE = 200;

const cache = new Map<string, CacheEntry>();

export function buildCacheKey(
  contractAddress: string,
  functionSelector: string,
): string {
  return `${contractAddress.toLowerCase()}:${functionSelector}`;
}

export function getCached(key: string): LLMResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return entry.response;
}

export function setCache(key: string, response: LLMResponse): void {
  // Prune expired entries first
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.timestamp > CACHE_TTL_MS) cache.delete(k);
  }

  // Evict oldest if still at capacity
  if (cache.size >= CACHE_MAX_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }

  cache.set(key, {
    response,
    timestamp: Date.now(),
  });
}

export function clearCache(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; maxSize: number } {
  return { size: cache.size, maxSize: CACHE_MAX_SIZE };
}
