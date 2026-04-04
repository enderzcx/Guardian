/**
 * Etherscan API — contract verification, source code, creation time
 * Requires API key for higher rate limits, works without for basic queries
 */

import { ETHERSCAN_API } from '@/config/endpoints';

export interface ContractInfo {
  verified: boolean;
  contractName: string;
  sourceAvailable: boolean;
  creationTxHash: string | null;
  creatorAddress: string | null;
  ageInDays: number | null;
}

let apiKey = '';

export function setEtherscanApiKey(key: string): void {
  apiKey = key;
}

function buildUrl(params: Record<string, string>): string {
  const query = new URLSearchParams({
    ...params,
    ...(apiKey ? { apikey: apiKey } : {}),
  });
  return `${ETHERSCAN_API}?${query.toString()}`;
}

export async function getContractInfo(
  address: string,
): Promise<ContractInfo | null> {
  const [source, creation] = await Promise.all([
    getContractSource(address),
    getContractCreation(address),
  ]);

  if (!source && !creation) return null;

  let ageInDays: number | null = null;
  if (creation?.timestamp) {
    const diffMs = Date.now() - creation.timestamp * 1000;
    ageInDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  return {
    verified: source?.verified ?? false,
    contractName: source?.contractName ?? 'Unknown',
    sourceAvailable: source?.sourceAvailable ?? false,
    creationTxHash: creation?.txHash ?? null,
    creatorAddress: creation?.creator ?? null,
    ageInDays,
  };
}

interface SourceResult {
  verified: boolean;
  contractName: string;
  sourceAvailable: boolean;
}

async function getContractSource(
  address: string,
): Promise<SourceResult | null> {
  try {
    const url = buildUrl({
      module: 'contract',
      action: 'getsourcecode',
      address,
    });

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      status: string;
      result: { ContractName: string; SourceCode: string; ABI: string }[];
    };

    if (data.status !== '1' || !data.result[0]) return null;

    const result = data.result[0];
    const hasSource = result.SourceCode !== '' && result.ABI !== 'Contract source code not verified';

    return {
      verified: hasSource,
      contractName: result.ContractName || 'Unknown',
      sourceAvailable: hasSource,
    };
  } catch {
    return null;
  }
}

interface CreationResult {
  txHash: string;
  creator: string;
  timestamp: number | null;
}

async function getContractCreation(
  address: string,
): Promise<CreationResult | null> {
  try {
    const url = buildUrl({
      module: 'contract',
      action: 'getcontractcreation',
      contractaddresses: address,
    });

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      status: string;
      result: { txHash: string; contractCreator: string }[];
    };

    if (data.status !== '1' || !data.result[0]) return null;

    const result = data.result[0];

    // Get block timestamp from creation tx
    const timestamp = await getTxTimestamp(result.txHash);

    return {
      txHash: result.txHash,
      creator: result.contractCreator,
      timestamp,
    };
  } catch {
    return null;
  }
}

async function getTxTimestamp(txHash: string): Promise<number | null> {
  try {
    const url = buildUrl({
      module: 'proxy',
      action: 'eth_getTransactionByHash',
      txhash: txHash,
    });

    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      result: { blockNumber: string } | null;
    };

    if (!data.result?.blockNumber) return null;

    // Get block timestamp
    const blockUrl = buildUrl({
      module: 'proxy',
      action: 'eth_getBlockByNumber',
      tag: data.result.blockNumber,
      boolean: 'false',
    });

    const blockResponse = await fetch(blockUrl, {
      signal: AbortSignal.timeout(3000),
    });

    if (!blockResponse.ok) return null;

    const blockData = (await blockResponse.json()) as {
      result: { timestamp: string } | null;
    };

    if (!blockData.result?.timestamp) return null;

    return parseInt(blockData.result.timestamp, 16);
  } catch {
    return null;
  }
}
