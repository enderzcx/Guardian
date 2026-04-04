/**
 * Price Service — token USD prices via CoinGecko
 * Uses free API with simple in-memory cache
 */

import { COINGECKO_API } from '@/config/endpoints';

interface PriceCache {
  price: number;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, PriceCache>();

/** Well-known token address → CoinGecko ID mapping */
const TOKEN_IDS: Record<string, string> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'ethereum',        // WETH
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'usd-coin',        // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'tether',           // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'dai',              // DAI
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'wrapped-bitcoin',  // WBTC
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'chainlink',        // LINK
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'uniswap',          // UNI
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'aave',             // AAVE
};

/** Stablecoins — always $1 (skip API call) */
const STABLECOINS = new Set([
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
]);

export async function getTokenPrice(
  contractAddress: string,
): Promise<number | null> {
  const addr = contractAddress.toLowerCase();

  if (STABLECOINS.has(addr)) return 1;

  const cached = cache.get(addr);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.price;
  }

  const coingeckoId = TOKEN_IDS[addr];
  if (!coingeckoId) return null;

  try {
    const url = `${COINGECKO_API}simple/price?ids=${coingeckoId}&vs_currencies=usd`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, { usd: number }>;
    const price = data[coingeckoId]?.usd ?? null;

    if (price !== null) {
      cache.set(addr, { price, timestamp: Date.now() });
    }

    return price;
  } catch {
    return null;
  }
}

/** Get ETH price (native token) */
export async function getEthPrice(): Promise<number | null> {
  return getTokenPrice('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
}
