/**
 * ABI Decoder — decodes raw calldata into human-readable format
 * Uses ethers.js + 4byte.directory fallback for unknown selectors
 */

import { Interface, Result } from 'ethers';
import { FOUR_BYTE_API } from '@/config/endpoints';

export interface DecodedCall {
  selector: string;
  name: string;
  args: Record<string, string>;
  raw: string;
}

/** Common ABI fragments for top DeFi protocols */
const KNOWN_FRAGMENTS = [
  // ERC-20
  'function approve(address spender, uint256 amount)',
  'function transfer(address to, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
  // Uniswap V2/V3
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function multicall(uint256 deadline, bytes[] data)',
  'function multicall(bytes[] data)',
  // ERC-721 / ERC-1155
  'function setApprovalForAll(address operator, bool approved)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  // Permit2
  'function permit(address owner, tuple(tuple(address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)',
];

const knownInterface = new Interface(KNOWN_FRAGMENTS);

const SELECTOR_CACHE_MAX = 500;
const selectorCache = new Map<string, string>();

export function decodeCalldata(data: string): DecodedCall | null {
  if (!data || data === '0x' || data.length < 10) return null;

  const selector = data.slice(0, 10);

  // Try known ABI fragments first
  const decoded = tryKnownDecode(data);
  if (decoded) return decoded;

  // Return raw selector info if we can't decode
  return {
    selector,
    name: selectorCache.get(selector) ?? 'Unknown Function',
    args: {},
    raw: data,
  };
}

function tryKnownDecode(data: string): DecodedCall | null {
  try {
    const parsed = knownInterface.parseTransaction({ data });
    if (!parsed) return null;

    const args: Record<string, string> = {};
    for (const [key, value] of Object.entries(formatArgs(parsed.args, parsed.fragment.inputs))) {
      args[key] = value;
    }

    return {
      selector: data.slice(0, 10),
      name: parsed.name,
      args,
      raw: data,
    };
  } catch {
    return null;
  }
}

function formatArgs(
  args: Result,
  inputs: readonly { name: string; type: string }[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const input of inputs) {
    const val = args[input.name];
    if (val === undefined) continue;
    result[input.name] = formatArgValue(val, input.type);
  }
  return result;
}

function formatArgValue(value: unknown, type: string): string {
  if (type === 'address') return String(value);
  if (type.startsWith('uint') || type.startsWith('int')) return String(value);
  if (type === 'bool') return String(value);
  if (type === 'address[]') return (value as string[]).join(', ');
  if (type === 'bytes[]') return `[${(value as string[]).length} items]`;
  if (type === 'bytes') return String(value).slice(0, 20) + '...';
  return String(value);
}

/**
 * Lookup function name from 4byte.directory
 * Returns null if not found or network error
 */
export async function lookup4byte(selector: string): Promise<string | null> {
  if (!/^0x[0-9a-fA-F]{8}$/.test(selector)) return null;
  if (selectorCache.has(selector)) return selectorCache.get(selector) ?? null;

  try {
    const url = `${FOUR_BYTE_API}?hex_signature=${encodeURIComponent(selector)}&format=json`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      results: { text_signature: string }[];
    };

    const name = data.results[0]?.text_signature ?? null;
    if (name) {
      if (selectorCache.size >= SELECTOR_CACHE_MAX) {
        const firstKey = selectorCache.keys().next().value;
        if (firstKey !== undefined) selectorCache.delete(firstKey);
      }
      selectorCache.set(selector, name);
    }
    return name;
  } catch {
    return null;
  }
}

/**
 * Enhanced decode — tries known ABI, then 4byte lookup
 */
export async function decodeCalldataWithLookup(
  data: string,
): Promise<DecodedCall | null> {
  const decoded = decodeCalldata(data);
  if (!decoded) return null;

  if (decoded.name === 'Unknown Function') {
    const name = await lookup4byte(decoded.selector);
    if (name) {
      decoded.name = name;
    }
  }

  return decoded;
}
