/**
 * Token Flow — resolves decoded tx args into human-readable in/out amounts
 * Uses contract-db for symbol lookup, price-service for USD values
 */

import type { DecodedInfo, TokenFlow } from '@/types';
import { lookupContract } from '@/core/contract-db';
import { getTokenPrice, getEthPrice } from '@/core/price-service';
import { formatAmount, formatUsd, isUnlimitedAmount } from '@/utils/format';

/** Well-known token decimals (mainnet) */
const TOKEN_DECIMALS: Record<string, number> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18, // WETH
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,  // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,  // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,  // WBTC
  '0x514910771af9ca656af840dff83e8264ecf986ca': 18, // LINK
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 18, // UNI
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 18, // AAVE
};

function getDecimals(addr: string): number {
  return TOKEN_DECIMALS[addr.toLowerCase()] ?? 18;
}

function getSymbol(addr: string): string {
  const known = lookupContract(addr.toLowerCase());
  return known?.name ?? 'Unknown Token';
}

/**
 * Compute token flow for a transaction.
 * Returns null for tx types that don't have meaningful flows (approve, etc.)
 */
export async function computeTokenFlow(
  decoded: DecodedInfo | null,
  ethValue: string,
): Promise<TokenFlow | null> {
  if (!decoded) return null;

  const fn = decoded.functionName.toLowerCase();

  // approve / permit / setApprovalForAll — no token flow
  if (fn.includes('approve') || fn.includes('permit')) return null;

  // Native ETH transfer
  if (fn === 'native transfer') {
    return buildNativeTransferFlow(ethValue);
  }

  // Swap variants
  if (fn.includes('swap')) {
    return buildSwapFlow(decoded, ethValue);
  }

  // ERC-20 transfer / transferFrom
  if (fn === 'transfer' || fn === 'transferfrom') {
    return buildTransferFlow(decoded);
  }

  return null;
}

async function buildNativeTransferFlow(value: string): Promise<TokenFlow | null> {
  const wei = parseBigInt(value);
  if (wei === 0n) return null;

  const ethPrice = await getEthPrice();
  const formatted = formatAmount(wei, 18);
  const usd = ethPrice ? formatUsd(Number(formatted) * ethPrice) : '?';

  return {
    out: { symbol: 'ETH', amount: formatted, usdValue: usd },
    in: null,
  };
}

async function buildSwapFlow(
  decoded: DecodedInfo,
  ethValue: string,
): Promise<TokenFlow | null> {
  const args = decoded.args;
  const fn = decoded.functionName.toLowerCase();
  const pathStr = args.path ?? '';
  const pathAddrs = pathStr
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('0x'));

  const tokenIn = pathAddrs[0] ?? '';
  const tokenOut = pathAddrs[pathAddrs.length - 1] ?? '';
  const isETHIn = fn.includes('swapexactethfor');
  const isETHOut = fn.includes('fortokensforeth') || fn.includes('foreth');

  // Amounts
  const amountIn = args.amountIn ?? '';
  const amountOutMin = args.amountOutMin ?? '';

  // Resolve in-token
  let outFlow: TokenFlow['out'] = null;
  if (isETHIn) {
    const wei = parseBigInt(ethValue);
    const ethPrice = await getEthPrice();
    const formatted = formatAmount(wei, 18);
    const usd = ethPrice ? formatUsd(Number(formatted) * ethPrice) : '?';
    outFlow = { symbol: 'ETH', amount: formatted, usdValue: usd };
  } else if (amountIn && tokenIn) {
    const decimals = getDecimals(tokenIn);
    const formatted = formatAmount(amountIn, decimals);
    const price = await getTokenPrice(tokenIn);
    const usd = price ? formatUsd(Number(formatted) * price) : '?';
    outFlow = { symbol: getSymbol(tokenIn), amount: formatted, usdValue: usd };
  }

  // Resolve out-token (minimum)
  let inFlow: TokenFlow['in'] = null;
  if (amountOutMin && tokenOut) {
    if (isETHOut) {
      const ethPrice = await getEthPrice();
      const formatted = formatAmount(amountOutMin, 18);
      const usd = ethPrice ? formatUsd(Number(formatted) * ethPrice) : '?';
      inFlow = { symbol: 'ETH (min)', amount: formatted, usdValue: usd };
    } else {
      const decimals = getDecimals(tokenOut);
      const formatted = formatAmount(amountOutMin, decimals);
      const price = await getTokenPrice(tokenOut);
      const usd = price ? formatUsd(Number(formatted) * price) : '?';
      inFlow = { symbol: `${getSymbol(tokenOut)} (min)`, amount: formatted, usdValue: usd };
    }
  }

  if (!outFlow && !inFlow) return null;
  return { out: outFlow, in: inFlow };
}

async function buildTransferFlow(
  decoded: DecodedInfo,
): Promise<TokenFlow | null> {
  const amount = decoded.args.amount ?? '';
  if (!amount || isUnlimitedAmount(amount)) return null;

  const token = decoded.contractAddress;
  const decimals = getDecimals(token);
  const formatted = formatAmount(amount, decimals);
  const price = await getTokenPrice(token);
  const usd = price ? formatUsd(Number(formatted) * price) : '?';

  return {
    out: { symbol: getSymbol(token), amount: formatted, usdValue: usd },
    in: null,
  };
}

function parseBigInt(value: string): bigint {
  try {
    if (value.startsWith('0x')) return BigInt(value);
    return BigInt(value);
  } catch {
    return 0n;
  }
}
