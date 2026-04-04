/**
 * Formatting utilities — addresses, amounts, timestamps
 */

/** Shorten address: 0x1234...abcd */
export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/** Format token amount with decimals */
export function formatAmount(
  raw: string | bigint,
  decimals: number,
  maxDecimals = 6,
): string {
  try {
    const value = typeof raw === 'string' ? BigInt(raw) : raw;
    if (value < 0n) return String(raw);

    const divisor = 10n ** BigInt(decimals);
    const whole = value / divisor;
    const remainder = value % divisor;

    if (remainder === 0n) return whole.toString();

    const fracStr = remainder.toString().padStart(decimals, '0');
    const trimmed = fracStr.slice(0, maxDecimals).replace(/0+$/, '');

    return trimmed ? `${whole}.${trimmed}` : whole.toString();
  } catch {
    return String(raw);
  }
}

/** Format USD value: $1,234.56 */
export function formatUsd(value: number): string {
  if (value < 0.01 && value > 0) return '<$0.01';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format timestamp to relative or future time */
export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp * 1000;
  const seconds = Math.floor(Math.abs(diff) / 1000);
  const isFuture = diff < 0;

  if (seconds < 60) return isFuture ? 'in <1m' : 'just now';
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return isFuture ? `in ${m}m` : `${m}m ago`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    return isFuture ? `in ${h}h` : `${h}h ago`;
  }
  const d = Math.floor(seconds / 86400);
  return isFuture ? `in ${d}d` : `${d}d ago`;
}

/** Check if amount is effectively unlimited (max uint256 or close) */
export function isUnlimitedAmount(amount: string | bigint): boolean {
  try {
    const value = typeof amount === 'string' ? BigInt(amount) : amount;
    return value > 10n ** 50n;
  } catch {
    return false;
  }
}
