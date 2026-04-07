/**
 * User Profile — determines user experience level from on-chain history
 * Caches result per address in chrome.storage.session
 */

import { ETHERSCAN_API } from '@/config/endpoints';
import { etherscanLimiter } from '@/utils/rate-limiter';

export interface UserProfile {
  totalTxCount: number;
  level: 'newcomer' | 'intermediate' | 'power_user';
  hasInteractedWith: (contract: string) => boolean;
}

interface CachedProfile {
  totalTxCount: number;
  interactedContracts: string[];
  timestamp: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getUserProfile(
  userAddress: string,
): Promise<UserProfile | null> {
  if (!userAddress) return null;

  const cached = await loadCachedProfile(userAddress);
  if (cached) return buildProfile(cached);

  // Fetch tx count and recent contract interactions from Etherscan
  const [txCount, contracts] = await Promise.all([
    fetchTxCount(userAddress),
    fetchRecentContracts(userAddress),
  ]);
  if (txCount === null) return null;

  const profile: CachedProfile = {
    totalTxCount: txCount,
    interactedContracts: contracts,
    timestamp: Date.now(),
  };

  await saveCachedProfile(userAddress, profile);
  return buildProfile(profile);
}

function buildProfile(cached: CachedProfile): UserProfile {
  const contracts = new Set(cached.interactedContracts.map((c) => c.toLowerCase()));
  return {
    totalTxCount: cached.totalTxCount,
    level: cached.totalTxCount < 20 ? 'newcomer'
      : cached.totalTxCount < 500 ? 'intermediate'
      : 'power_user',
    hasInteractedWith: (contract: string) => contracts.has(contract.toLowerCase()),
  };
}

async function fetchTxCount(address: string): Promise<number | null> {
  try {
    await etherscanLimiter.acquire();
    const url = `${ETHERSCAN_API}?module=proxy&action=eth_getTransactionCount&address=${address}&tag=latest`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { result: string };
    return parseInt(data.result, 16);
  } catch (error) {
    console.debug('[Guardian] Etherscan fetchTxCount failed:', error);
    return null;
  }
}

async function fetchRecentContracts(address: string): Promise<string[]> {
  try {
    await etherscanLimiter.acquire();
    const url = `${ETHERSCAN_API}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];

    const data = (await response.json()) as {
      status: string;
      result: { to: string }[] | string;
    };
    if (data.status !== '1' || !Array.isArray(data.result)) return [];

    const contracts = new Set<string>();
    for (const tx of data.result) {
      if (tx.to) contracts.add(tx.to.toLowerCase());
    }
    return [...contracts];
  } catch {
    return [];
  }
}

async function loadCachedProfile(
  address: string,
): Promise<CachedProfile | null> {
  try {
    const key = `profile_${address.toLowerCase()}`;
    const result = await chrome.storage.session.get(key);
    const cached = result[key] as CachedProfile | undefined;
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
    return cached;
  } catch (error) {
    console.debug('[Guardian] Profile cache load failed:', error);
    return null;
  }
}

async function saveCachedProfile(
  address: string,
  profile: CachedProfile,
): Promise<void> {
  try {
    const key = `profile_${address.toLowerCase()}`;
    await chrome.storage.session.set({ [key]: profile });
  } catch (error) {
    console.debug('[Guardian] Profile cache save failed (storage.session may be unavailable):', error);
  }
}
