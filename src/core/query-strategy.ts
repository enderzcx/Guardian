/**
 * Query Strategy — decides what external lookups are needed per transaction
 *
 * Trust levels:
 *   0 = blacklisted (known malicious)
 *   1 = unknown (not in any database)
 *   2 = identified (Etherscan verified, >30 days, but not manually reviewed)
 *   3 = known (in contract-db, manually curated as trusted)
 *
 * Core rule: trust the CONTRACT, but always verify the TRANSACTION.
 */

import { lookupContract, isKnownContract } from '@/core/contract-db';

export type TrustLevel = 0 | 1 | 2 | 3;

export interface QueryPlan {
  queryContract: boolean;
  querySpender: boolean;
  callAI: boolean;
  reason: string;
}

const APPROVE_KEYWORDS = [
  'approve', 'permit', 'setapprovalforall',
  'increaseallowance', 'decreaseallowance',
];

export function isAuthorizationOp(functionName: string): boolean {
  const fn = functionName.toLowerCase();
  return APPROVE_KEYWORDS.some((kw) => fn.includes(kw));
}

export function getContractTrustLevel(address: string): TrustLevel {
  if (!address) return 1;
  // Level 3: in our curated known contract DB
  if (isKnownContract(address)) return 3;
  // Level 0-2 requires external lookup (GoPlus/Etherscan)
  // At this point we don't know yet, default to 1
  return 1;
}

export function buildQueryPlan(
  contractAddr: string,
  spenderAddr: string | null,
  functionName: string,
  method: string,
): QueryPlan {
  const contractLevel = getContractTrustLevel(contractAddr);
  const spenderLevel = spenderAddr ? getContractTrustLevel(spenderAddr) : null;
  const isAuthOp = isAuthorizationOp(functionName);
  const isTypedData = method.startsWith('eth_signTypedData');

  // EIP-712 signatures always need full analysis
  if (isTypedData) {
    return {
      queryContract: contractLevel < 2,
      querySpender: spenderLevel !== null && spenderLevel < 3,
      callAI: true,
      reason: 'EIP-712 signature — always analyze',
    };
  }

  // Authorization operations (approve/permit/setApprovalForAll)
  if (isAuthOp) {
    const needsSpenderCheck = spenderLevel !== null && spenderLevel < 3;
    return {
      queryContract: contractLevel < 2,
      querySpender: needsSpenderCheck,
      callAI: true,  // always AI for auth ops
      reason: needsSpenderCheck
        ? 'Authorization to unknown spender'
        : 'Authorization to known spender',
    };
  }

  // Native ETH transfer (no calldata, just sending ETH)
  const fn = functionName.toLowerCase();
  if (fn === 'native transfer' || fn === 'contract creation') {
    return {
      queryContract: false,
      querySpender: false,
      callAI: false,
      reason: fn === 'native transfer' ? 'Simple ETH transfer' : 'Contract creation',
    };
  }

  // Non-auth ops on known contracts (swap on Uniswap etc.)
  if (contractLevel === 3) {
    return {
      queryContract: false,
      querySpender: false,
      callAI: false,
      reason: 'Routine operation on known contract — skip AI',
    };
  }

  // Unknown contract, non-auth operation
  return {
    queryContract: true,
    querySpender: false,
    callAI: true,
    reason: 'Unknown contract',
  };
}

/** Extract spender/operator address from decoded args */
export function extractTargetAddress(
  args: Record<string, string>,
): string | null {
  return args.spender ?? args.operator ?? args.to ?? null;
}
