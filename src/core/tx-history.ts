/**
 * Transaction History — persists analyzed txs to chrome.storage.local
 * Popup reads this to show recent activity + stats
 */

export interface TxRecord {
  id: string;
  timestamp: number;
  method: string;
  summary: string;
  score: number;
  riskLevel: 'green' | 'yellow' | 'red';
  aiExplanation: string | null;
  decision: 'approved' | 'rejected' | 'pending';
  contractAddress: string;
}

export interface ProtectionStats {
  totalScanned: number;
  totalBlocked: number;
  highRiskCaught: number;
}

const STORAGE_KEY = 'guardian_tx_history';
const STATS_KEY = 'guardian_stats';
const MAX_RECORDS = 50;

export async function addTxRecord(record: TxRecord): Promise<void> {
  const history = await getHistory();
  history.unshift(record);
  if (history.length > MAX_RECORDS) {
    history.length = MAX_RECORDS;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: history });
}

export async function updateTxDecision(
  txId: string,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const history = await getHistory();
  const record = history.find((r) => r.id === txId);
  if (record) {
    record.decision = decision;
    await chrome.storage.local.set({ [STORAGE_KEY]: history });
  }

  // Update stats
  if (decision === 'rejected') {
    const stats = await getStats();
    stats.totalBlocked++;
    await chrome.storage.local.set({ [STATS_KEY]: stats });
  }
}

export async function updateTxAI(
  txId: string,
  score: number,
  explanation: string,
): Promise<void> {
  const history = await getHistory();
  const record = history.find((r) => r.id === txId);
  if (record) {
    record.score = score;
    record.riskLevel = score <= 30 ? 'green' : score <= 70 ? 'yellow' : 'red';
    record.aiExplanation = explanation;
    await chrome.storage.local.set({ [STORAGE_KEY]: history });
  }
}

export async function getHistory(): Promise<TxRecord[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as TxRecord[]) ?? [];
}

export async function getStats(): Promise<ProtectionStats> {
  const result = await chrome.storage.local.get(STATS_KEY);
  return (result[STATS_KEY] as ProtectionStats) ?? {
    totalScanned: 0,
    totalBlocked: 0,
    highRiskCaught: 0,
  };
}

export async function incrementScanned(isHighRisk: boolean): Promise<void> {
  const stats = await getStats();
  stats.totalScanned++;
  if (isHighRisk) stats.highRiskCaught++;
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEY, STATS_KEY]);
}
