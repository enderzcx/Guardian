/**
 * Context Fetcher — gathers enriched context for Tier 2 AI analysis
 * Respects QueryPlan to skip unnecessary external lookups
 */

import type { ContractContext, ThreatContext, UserContext } from '@/ai/prompt-builder';
import type { QueryPlan } from '@/core/query-strategy';
import { checkTokenSecurity, checkAddressSecurity } from '@/intel/goplus';
import { getContractInfo } from '@/intel/etherscan';
import { lookupContract } from '@/core/contract-db';
import { getUserProfile } from '@/core/user-profile';

export interface FetchedContext {
  contract: ContractContext | null;
  threat: ThreatContext | null;
  user: UserContext | null;
}

export async function fetchAllContext(
  plan: QueryPlan,
  contractAddr: string,
  spenderAddr: string | null,
  userAddr: string | null,
): Promise<FetchedContext> {
  const promises: [
    Promise<ContractContext | null>,
    Promise<ThreatContext | null>,
    Promise<ThreatContext | null>,
    Promise<UserContext | null>,
  ] = [
    plan.queryContract ? fetchContractContext(contractAddr) : buildKnownContractCtx(contractAddr),
    plan.queryContract ? fetchThreatContext(contractAddr) : Promise.resolve(null),
    plan.querySpender && spenderAddr ? fetchThreatContext(spenderAddr) : Promise.resolve(null),
    userAddr ? fetchUserContext(userAddr, contractAddr) : Promise.resolve(null),
  ];

  const [contract, contractThreat, spenderThreat, user] = await Promise.all(promises);

  return {
    contract,
    threat: mergeThreatContexts(contractThreat, spenderThreat),
    user,
  };
}

async function buildKnownContractCtx(address: string): Promise<ContractContext | null> {
  const known = lookupContract(address);
  if (!known) return null;
  return {
    verified: true,
    sourceAvailable: true,
    ageInDays: 365,
    tvl: null,
    ownerPrivileges: [],
    interactions: null,
  };
}

async function fetchContractContext(address: string): Promise<ContractContext | null> {
  if (!address) return null;

  const known = lookupContract(address);
  const etherscanInfo = await Promise.race([
    getContractInfo(address).catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 4000)),
  ]);

  return {
    verified: known?.trusted ?? etherscanInfo?.verified ?? false,
    sourceAvailable: etherscanInfo?.sourceAvailable ?? false,
    ageInDays: etherscanInfo?.ageInDays ?? null,
    tvl: null,
    ownerPrivileges: [],
    interactions: null,
  };
}

async function fetchThreatContext(address: string): Promise<ThreatContext | null> {
  if (!address) return null;

  const [tokenSec, addrSec] = await Promise.all([
    checkTokenSecurity('1', address).catch(() => null),
    checkAddressSecurity('1', address).catch(() => null),
  ]);

  if (!tokenSec && !addrSec) return null;

  const flags: string[] = [];
  if (tokenSec?.isHoneypot) flags.push('honeypot');
  if (tokenSec?.isMintable) flags.push('owner can mint');
  if (tokenSec?.canPause) flags.push('owner can pause');
  if (tokenSec?.canBlacklist) flags.push('has blacklist');
  if (addrSec?.flags) flags.push(...addrSec.flags);

  return {
    isBlacklisted: addrSec?.isBlacklisted ?? false,
    isHoneypot: tokenSec?.isHoneypot ?? false,
    flags,
    victimCount: null,
    stolenAmount: null,
  };
}

async function fetchUserContext(
  address: string,
  contractAddr?: string,
): Promise<UserContext | null> {
  const profile = await getUserProfile(address).catch(() => null);
  if (!profile) return null;
  return {
    totalTxCount: profile.totalTxCount,
    hasInteractedBefore: contractAddr ? profile.hasInteractedWith(contractAddr) : false,
  };
}

function mergeThreatContexts(
  a: ThreatContext | null,
  b: ThreatContext | null,
): ThreatContext | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return {
    isBlacklisted: a.isBlacklisted || b.isBlacklisted,
    isHoneypot: a.isHoneypot || b.isHoneypot,
    flags: [...new Set([...a.flags, ...b.flags])],
    victimCount: a.victimCount ?? b.victimCount,
    stolenAmount: a.stolenAmount ?? b.stolenAmount,
  };
}
