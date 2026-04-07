/**
 * Approval Scanner — fetches active ERC-20/721/1155 approvals from Etherscan logs
 * Deduplicates by (token, spender) and filters out revoked (amount=0)
 */

import { ETHERSCAN_API } from '@/config/endpoints';
import { lookupContract } from '@/core/contract-db';
import { isUnlimitedAmount } from '@/utils/format';

export interface ActiveApproval {
  token: string;
  tokenName: string;
  spender: string;
  spenderName: string;
  amount: string;
  isUnlimited: boolean;
  type: 'erc20' | 'nft' | 'nft-all';
  timestamp: number;
  txHash: string;
  riskLevel: 'green' | 'yellow' | 'red';
}

/** ERC-20 Approval event: keccak256("Approval(address,address,uint256)") */
const APPROVAL_TOPIC =
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

/** ERC-721/1155 ApprovalForAll: keccak256("ApprovalForAll(address,address,bool)") */
const APPROVAL_FOR_ALL_TOPIC =
  '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31';

const CACHE_KEY = 'guardian_approvals';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedApprovals {
  address: string;
  approvals: ActiveApproval[];
  timestamp: number;
}

export async function scanApprovals(
  userAddress: string,
): Promise<ActiveApproval[]> {
  if (!userAddress) return [];

  // Check cache
  const cached = await loadCached(userAddress);
  if (cached) return cached;

  const [erc20, nftAll] = await Promise.all([
    fetchApprovalLogs(userAddress),
    fetchApprovalForAllLogs(userAddress),
  ]);

  const approvals = deduplicateApprovals([...erc20, ...nftAll]);
  await saveCache(userAddress, approvals);
  return approvals;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

async function fetchPaginatedLogs(
  baseUrl: string,
  parser: (log: EtherscanLog) => ActiveApproval | null,
): Promise<ActiveApproval[]> {
  const all: ActiveApproval[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${baseUrl}&page=${page}&offset=${PAGE_SIZE}`;
    const logs = await fetchLogs(url);
    const parsed = logs.map(parser).filter(Boolean) as ActiveApproval[];
    all.push(...parsed);
    if (logs.length < PAGE_SIZE) break; // no more pages
  }
  return all;
}

async function fetchApprovalLogs(
  owner: string,
): Promise<ActiveApproval[]> {
  const paddedOwner = padAddress(owner);
  const baseUrl = `${ETHERSCAN_API}?module=logs&action=getLogs` +
    `&fromBlock=0&toBlock=latest` +
    `&topic0=${APPROVAL_TOPIC}` +
    `&topic0_1_opr=and&topic1=${paddedOwner}`;

  return fetchPaginatedLogs(baseUrl, parseApprovalLog);
}

async function fetchApprovalForAllLogs(
  owner: string,
): Promise<ActiveApproval[]> {
  const paddedOwner = padAddress(owner);
  const baseUrl = `${ETHERSCAN_API}?module=logs&action=getLogs` +
    `&fromBlock=0&toBlock=latest` +
    `&topic0=${APPROVAL_FOR_ALL_TOPIC}` +
    `&topic0_1_opr=and&topic1=${paddedOwner}`;

  return fetchPaginatedLogs(baseUrl, parseApprovalForAllLog);
}

interface EtherscanLog {
  address: string;
  topics: string[];
  data: string;
  timeStamp: string;
  transactionHash: string;
}

async function fetchLogs(url: string): Promise<EtherscanLog[]> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return [];

    const data = (await response.json()) as {
      status: string;
      result: EtherscanLog[] | string;
    };

    if (data.status !== '1' || !Array.isArray(data.result)) return [];
    return data.result;
  } catch (error) {
    console.debug('[Guardian] Etherscan fetchLogs failed:', error);
    return [];
  }
}

function parseApprovalLog(log: EtherscanLog): ActiveApproval | null {
  if (log.topics.length < 3) return null;

  const token = extractAddress(log.address);
  const spender = extractAddress(log.topics[2]);
  const amount = log.data === '0x' ? '0' : BigInt(log.data).toString();

  const unlimited = isUnlimitedAmount(amount);
  const known = lookupContract(token);
  const spenderKnown = lookupContract(spender);

  return {
    token,
    tokenName: known?.name ?? shortenAddr(token),
    spender,
    spenderName: spenderKnown?.name ?? shortenAddr(spender),
    amount,
    isUnlimited: unlimited,
    type: 'erc20' as const,
    timestamp: parseInt(log.timeStamp, 16) * 1000,
    txHash: log.transactionHash,
    riskLevel: scoreApprovalRisk(unlimited, spenderKnown !== null),
  };
}

function parseApprovalForAllLog(log: EtherscanLog): ActiveApproval | null {
  if (log.topics.length < 3) return null;

  const token = extractAddress(log.address);
  const operator = extractAddress(log.topics[2]);

  const approved = log.data !== '0x' + '0'.repeat(64);

  const known = lookupContract(token);
  const operatorKnown = lookupContract(operator);

  return {
    token,
    tokenName: known?.name ?? shortenAddr(token),
    spender: operator,
    spenderName: operatorKnown?.name ?? shortenAddr(operator),
    amount: approved ? 'ALL' : '0',
    isUnlimited: approved,
    type: 'nft-all',
    timestamp: parseInt(log.timeStamp, 16) * 1000,
    txHash: log.transactionHash,
    riskLevel: scoreApprovalRisk(true, operatorKnown !== null),
  };
}

function scoreApprovalRisk(
  unlimited: boolean,
  knownSpender: boolean,
): 'green' | 'yellow' | 'red' {
  if (unlimited && !knownSpender) return 'red';
  if (unlimited && knownSpender) return 'yellow';
  if (!knownSpender) return 'yellow';
  return 'green';
}

/**
 * Deduplicate by (token, spender) — keep latest event only.
 * Then filter out revokes (amount=0) — a later revoke cancels earlier approvals.
 */
function deduplicateApprovals(approvals: ActiveApproval[]): ActiveApproval[] {
  const map = new Map<string, ActiveApproval>();
  // Sort oldest first so latest overwrites
  approvals.sort((a, b) => a.timestamp - b.timestamp);
  for (const a of approvals) {
    map.set(`${a.token}:${a.spender}`.toLowerCase(), a);
  }
  // Filter out revokes (amount=0), then return newest first
  return [...map.values()]
    .filter((a) => a.amount !== '0')
    .sort((a, b) => b.timestamp - a.timestamp);
}

function padAddress(addr: string): string {
  return '0x' + addr.slice(2).toLowerCase().padStart(64, '0');
}

function extractAddress(raw: string): string {
  return '0x' + raw.slice(-40).toLowerCase();
}

function shortenAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function loadCached(address: string): Promise<ActiveApproval[] | null> {
  try {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const cached = result[CACHE_KEY] as CachedApprovals | undefined;
    if (!cached) return null;
    if (cached.address.toLowerCase() !== address.toLowerCase()) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
    return cached.approvals;
  } catch (error) {
    console.debug('[Guardian] Approval cache load failed:', error);
    return null;
  }
}

async function saveCache(
  address: string,
  approvals: ActiveApproval[],
): Promise<void> {
  try {
    await chrome.storage.local.set({
      [CACHE_KEY]: { address, approvals, timestamp: Date.now() },
    });
  } catch (error) {
    console.debug('[Guardian] Approval cache save failed:', error);
  }
}

export async function clearApprovalCache(): Promise<void> {
  await chrome.storage.local.remove(CACHE_KEY);
}
