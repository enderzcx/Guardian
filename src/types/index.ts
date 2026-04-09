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
  /** 4-byte calldata selector, e.g. "0x095ea7b3" */
  selector?: string;
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
  payload: InterceptedTransaction;
}

export interface GuardianDecisionMessage {
  type: 'guardian:decision';
  decisionToken: string;
  id: string;
  approved: boolean;
}

export type GuardianMessage = GuardianInterceptMessage | GuardianDecisionMessage;
