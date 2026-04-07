/**
 * Tier 1 Analyzer — fast local decode + heuristic risk scoring
 * Runs in <200ms, no external API calls
 */

import type { AnalysisResult, DecodedInfo } from '@/types';
import { decodeCalldataWithLookup } from '@/core/abi-decoder';
import { parseEIP712 } from '@/utils/eip712-parser';
import { isTrustedContract } from '@/core/contract-db';

export async function runTier1(
  id: string,
  method: string,
  params: unknown[],
): Promise<AnalysisResult> {
  const isSignTypedData = method.startsWith('eth_signTypedData');
  const decoded = isSignTypedData
    ? decodeTypedData(params)
    : await decodeTransaction(params);

  const score = estimateRiskScore(method, decoded);

  return {
    id,
    score,
    tier: 1,
    riskLevel: scoreToLevel(score),
    summary: decoded?.functionName ?? `${method} — unable to decode`,
    decoded,
    tokenFlow: null,
    aiExplanation: null,
  };
}

export function shouldTriggerTier2(
  score: number,
  method: string,
  decoded: DecodedInfo | null,
): boolean {
  if (method.startsWith('eth_signTypedData')) return true;
  const fn = decoded?.functionName.toLowerCase() ?? '';
  if (fn.includes('approve') || fn.includes('permit')) return true;
  if (fn.includes('setapprovalforall')) return true;
  if (fn === 'unknown function') return true;
  if (score > 30) return true;
  return false;
}

async function decodeTransaction(params: unknown[]): Promise<DecodedInfo | null> {
  const tx = params[0];
  if (!tx || typeof tx !== 'object') return null;
  const txObj = tx as Record<string, string>;
  const data = txObj.data ?? txObj.input ?? '0x';
  const decoded = await decodeCalldataWithLookup(data);
  return {
    functionName: decoded?.name ?? (txObj.to ? 'Native Transfer' : 'Contract Creation'),
    args: decoded?.args ?? {},
    contractAddress: txObj.to ?? '',
    value: txObj.value ?? '0x0',
  };
}

function decodeTypedData(params: unknown[]): DecodedInfo | null {
  const raw = params[1];
  let data: unknown;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw as string) : raw;
  } catch (error) {
    console.debug('[Guardian] EIP-712 JSON parse failed:', error);
    return null;
  }
  const parsed = parseEIP712(data);
  if (!parsed) return null;
  return {
    functionName: parsed.label,
    args: {
      ...(parsed.token ? { token: parsed.token } : {}),
      ...(parsed.spender ? { spender: parsed.spender } : {}),
      ...(parsed.amount ? { amount: parsed.amount } : {}),
      ...(parsed.deadline ? { deadline: parsed.deadline } : {}),
    },
    contractAddress: parsed.token ?? '',
    value: '0x0',
    eip712Pattern: parsed.pattern,
    eip712Label: parsed.label,
    eip712RiskFactors: parsed.riskFactors,
  };
}

function estimateRiskScore(method: string, decoded: DecodedInfo | null): number {
  let score = 10;
  if (!decoded) return 50;

  // Known trusted contracts get a bonus
  if (decoded.contractAddress && isTrustedContract(decoded.contractAddress)) {
    score -= 10;
  }
  const fn = decoded.functionName.toLowerCase();
  if (fn.includes('setapprovalforall')) {
    score += 50;
  } else if (fn.includes('approve')) {
    score += decoded.args.amount === 'Unlimited' ? 45 : 20;
  }
  if (fn.includes('permit')) score += 25;
  if (decoded.eip712RiskFactors?.length) {
    score += decoded.eip712RiskFactors.length * 15;
  }
  if (method.startsWith('eth_signTypedData')) score += 10;
  // Cap low-risk swaps/transfers — but only if score is still in the low range.
  // A swap to a malicious contract can score >30, and should NOT be capped.
  if (fn.includes('swap') && score <= 30) score = 25;
  if (fn === 'native transfer' && score <= 20) score = 15;
  return Math.min(score, 100);
}

function scoreToLevel(score: number): 'green' | 'yellow' | 'red' {
  if (score <= 30) return 'green';
  if (score <= 70) return 'yellow';
  return 'red';
}
