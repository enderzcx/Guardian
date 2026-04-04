/**
 * EIP-712 Typed Data Parser
 * Identifies common patterns (Permit, Permit2, SeaPort, etc.)
 * and extracts human-readable fields
 */

export interface EIP712TypedData {
  domain: {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
  };
  primaryType: string;
  types: Record<string, { name: string; type: string }[]>;
  message: Record<string, unknown>;
}

export type SignaturePattern =
  | 'permit'
  | 'permit2'
  | 'seaport-order'
  | 'dai-permit'
  | 'approval'
  | 'unknown';

export interface ParsedEIP712 {
  pattern: SignaturePattern;
  label: string;
  token: string | null;
  spender: string | null;
  amount: string | null;
  deadline: string | null;
  riskFactors: string[];
}

const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const MAX_UINT160 =
  '1461501637330902918203684832716283019655932542975';

export function parseEIP712(raw: unknown): ParsedEIP712 | null {
  if (!isValidTypedData(raw)) return null;

  const data = raw as EIP712TypedData;
  const pattern = identifyPattern(data);

  switch (pattern) {
    case 'permit':
      return parsePermit(data);
    case 'permit2':
      return parsePermit2(data);
    case 'dai-permit':
      return parseDaiPermit(data);
    case 'seaport-order':
      return parseSeaportOrder(data);
    default:
      return parseUnknown(data);
  }
}

function isValidTypedData(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return (
    typeof obj.primaryType === 'string' &&
    typeof obj.types === 'object' &&
    obj.types !== null &&
    typeof obj.message === 'object' &&
    obj.message !== null &&
    typeof obj.domain === 'object'
  );
}

function identifyPattern(data: EIP712TypedData): SignaturePattern {
  const { primaryType, domain, types } = data;

  if (primaryType === 'Permit' && domain.name === 'Dai Stablecoin') {
    return 'dai-permit';
  }
  if (primaryType === 'Permit' && types.Permit) return 'permit';
  if (primaryType === 'PermitSingle' || primaryType === 'PermitBatch') {
    return 'permit2';
  }
  if (primaryType === 'OrderComponents' || primaryType === 'Order') {
    return 'seaport-order';
  }

  return 'unknown';
}

function isUnlimited(amount: string | undefined): boolean {
  if (!amount) return false;
  return amount === MAX_UINT256 || amount === MAX_UINT160;
}

function parsePermit(data: EIP712TypedData): ParsedEIP712 {
  const msg = data.message;
  const amount = String(msg.value ?? msg.amount ?? '');
  const riskFactors: string[] = [];

  if (isUnlimited(amount)) {
    riskFactors.push('Unlimited token approval');
  }

  return {
    pattern: 'permit',
    label: `Permit — ${data.domain.name ?? 'Unknown Token'}`,
    token: data.domain.verifyingContract ?? null,
    spender: String(msg.spender ?? ''),
    amount: isUnlimited(amount) ? 'Unlimited' : amount,
    deadline: msg.deadline ? String(msg.deadline) : null,
    riskFactors,
  };
}

function parsePermit2(data: EIP712TypedData): ParsedEIP712 {
  const msg = data.message;
  const rawDetails = msg.details;
  const isBatch = Array.isArray(rawDetails);
  const details = (isBatch ? rawDetails[0] : rawDetails) as Record<string, unknown> | undefined;
  const amount = String(details?.amount ?? '');
  const riskFactors: string[] = [];

  riskFactors.push('Off-chain signature — no gas fee but grants real permissions');
  if (isBatch && rawDetails.length > 1) {
    riskFactors.push(`Batch permit for ${rawDetails.length} tokens at once`);
  }
  if (isUnlimited(amount)) {
    riskFactors.push('Unlimited token permission');
  }

  return {
    pattern: 'permit2',
    label: isBatch ? `Permit2 Batch — ${rawDetails.length} Tokens` : 'Permit2 — Token Permission',
    token: String(details?.token ?? ''),
    spender: String(msg.spender ?? ''),
    amount: isUnlimited(amount) ? 'Unlimited' : amount,
    deadline: msg.sigDeadline ? String(msg.sigDeadline) : null,
    riskFactors,
  };
}

function parseDaiPermit(data: EIP712TypedData): ParsedEIP712 {
  const msg = data.message;
  return {
    pattern: 'dai-permit',
    label: 'DAI Permit',
    token: data.domain.verifyingContract ?? null,
    spender: String(msg.spender ?? ''),
    amount: msg.allowed === true ? 'Unlimited' : '0',
    deadline: msg.expiry ? String(msg.expiry) : null,
    riskFactors: msg.allowed === true ? ['Unlimited DAI approval'] : [],
  };
}

function parseSeaportOrder(data: EIP712TypedData): ParsedEIP712 {
  const msg = data.message;
  const offer = msg.offer as Record<string, unknown>[] | undefined;

  return {
    pattern: 'seaport-order',
    label: 'NFT Marketplace Order',
    token: null,
    spender: null,
    amount: offer ? `${offer.length} item(s)` : 'Unknown',
    deadline: msg.endTime ? String(msg.endTime) : null,
    riskFactors: ['NFT listing — verify marketplace and items carefully'],
  };
}

function parseUnknown(data: EIP712TypedData): ParsedEIP712 {
  return {
    pattern: 'unknown',
    label: `${data.primaryType} — ${data.domain.name ?? 'Unknown Protocol'}`,
    token: data.domain.verifyingContract ?? null,
    spender: null,
    amount: null,
    deadline: null,
    riskFactors: ['Unknown signature type — review carefully'],
  };
}
