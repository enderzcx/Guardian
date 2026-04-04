/** Shared types across all Guardian modules */

export interface InterceptedTransaction {
  method: string;
  params: unknown[];
  id: string;
}

export interface TokenFlow {
  out: { symbol: string; amount: string; usdValue: string } | null;
  in: { symbol: string; amount: string; usdValue: string } | null;
}

export interface DecodedInfo {
  functionName: string;
  args: Record<string, string>;
  contractAddress: string;
  value: string;
  /** For EIP-712 signatures */
  eip712Pattern?: string;
  eip712Label?: string;
  eip712RiskFactors?: string[];
}

export interface AnalysisResult {
  id: string;
  score: number;
  tier: number;
  riskLevel: 'green' | 'yellow' | 'red';
  summary: string;
  decoded: DecodedInfo | null;
  tokenFlow: TokenFlow | null;
  aiExplanation: string | null;
  error?: string;
}

export interface GuardianInterceptMessage {
  type: 'guardian:intercept';
  nonce: string;
  payload: InterceptedTransaction;
}

export interface GuardianDecisionMessage {
  type: 'guardian:decision';
  nonce: string;
  id: string;
  approved: boolean;
}

export type GuardianMessage = GuardianInterceptMessage | GuardianDecisionMessage;
