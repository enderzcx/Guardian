import React, { useEffect, useState } from 'react';
import type { TxRecord, ProtectionStats } from '@/core/tx-history';

const RISK_COLORS = { green: '#4ade80', yellow: '#facc15', red: '#f87171' };

export function App(): React.JSX.Element {
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [stats, setStats] = useState<ProtectionStats>({ totalScanned: 0, totalBlocked: 0, highRiskCaught: 0 });
  const [enabled, setEnabled] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['guardian_tx_history', 'guardian_stats', 'guardian_enabled']).then((r) => {
      setHistory((r.guardian_tx_history as TxRecord[]) ?? []);
      setStats((r.guardian_stats as ProtectionStats) ?? { totalScanned: 0, totalBlocked: 0, highRiskCaught: 0 });
      setEnabled(r.guardian_enabled !== false);
    });
  }, []);

  const toggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    chrome.storage.local.set({ guardian_enabled: next });
  };

  const saveKey = () => {
    if (!apiKey.trim()) return;
    chrome.runtime.sendMessage({ type: 'SET_API_KEY', key: apiKey.trim() });
    setApiKey('');
  };

  const clearAll = () => {
    chrome.storage.local.remove(['guardian_tx_history', 'guardian_stats']);
    setHistory([]);
    setStats({ totalScanned: 0, totalBlocked: 0, highRiskCaught: 0 });
  };

  return (
    <div style={{ padding: 16, minHeight: 480 }}>
      <Header enabled={enabled} onToggle={toggleEnabled} onSettings={() => setShowSettings(!showSettings)} />

      <DashboardButton />

      {showSettings ? (
        <Settings apiKey={apiKey} setApiKey={setApiKey} saveKey={saveKey} clearAll={clearAll} />
      ) : (
        <>
          <StatsBar stats={stats} />
          <TxList history={history} />
        </>
      )}

      <footer style={{ textAlign: 'center', fontSize: 10, opacity: 0.25, marginTop: 16 }}>
        v0.1.0 — AI is the spine.
      </footer>
    </div>
  );
}

function Header({ enabled, onToggle, onSettings }: {
  enabled: boolean; onToggle: () => void; onSettings: () => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Guardian</div>
        <div style={{ fontSize: 11, opacity: 0.4, marginTop: 2 }}>照妖镜</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={onSettings} style={iconBtnStyle} title="Settings">&#9881;</button>
        <button onClick={onToggle} style={{
          ...pillStyle,
          background: enabled ? '#2d5a27' : '#5a2727',
        }}>
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
}

function DashboardButton() {
  const openDashboard = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    window.close();
  };
  return (
    <button onClick={openDashboard} style={{
      width: '100%', padding: '10px', marginBottom: 12, borderRadius: 8,
      background: '#222240', border: '1px solid rgba(255,255,255,0.08)',
      color: '#e0e0e0', cursor: 'pointer', fontSize: 13, fontWeight: 500,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span>Approval Dashboard</span>
      <span style={{ opacity: 0.4 }}>&rarr;</span>
    </button>
  );
}

function StatsBar({ stats }: { stats: ProtectionStats }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-around',
      padding: '10px 0', marginBottom: 12,
      borderTop: '1px solid rgba(255,255,255,0.06)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <StatItem label="Scanned" value={stats.totalScanned} />
      <StatItem label="Blocked" value={stats.totalBlocked} color="#f87171" />
      <StatItem label="High Risk" value={stats.highRiskCaught} color="#facc15" />
    </div>
  );
}

function StatItem({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? '#fff', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, opacity: 0.4, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function TxList({ history }: { history: TxRecord[] }) {
  if (history.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', opacity: 0.3, fontSize: 13 }}>
        No transactions yet.<br />Guardian will appear when you sign.
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
      {history.slice(0, 20).map((tx) => (
        <TxRow key={tx.id} tx={tx} />
      ))}
    </div>
  );
}

function TxRow({ tx }: { tx: TxRecord }) {
  const color = RISK_COLORS[tx.riskLevel];
  const time = new Date(tx.timestamp);
  const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 0',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: color, flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 500, color: '#e0e0e0',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {tx.summary}
        </div>
        {tx.aiExplanation && (
          <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>
            {tx.aiExplanation.slice(0, 80)}{tx.aiExplanation.length > 80 ? '...' : ''}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
          {tx.score}
        </div>
        <div style={{ fontSize: 9, opacity: 0.35, marginTop: 1 }}>
          {timeStr} {tx.decision === 'rejected' ? '✕' : tx.decision === 'approved' ? '✓' : '...'}
        </div>
      </div>
    </div>
  );
}

function Settings({ apiKey, setApiKey, saveKey, clearAll }: {
  apiKey: string; setApiKey: (v: string) => void; saveKey: () => void; clearAll: () => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, opacity: 0.6 }}>SETTINGS</div>

      <label style={{ fontSize: 11, opacity: 0.5 }}>AI API Key</label>
      <div style={{ display: 'flex', gap: 6, marginTop: 4, marginBottom: 16 }}>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-... or leave for default"
          style={inputStyle}
        />
        <button onClick={saveKey} style={{ ...pillStyle, background: '#2d5a27' }}>Save</button>
      </div>

      <button onClick={clearAll} style={{ ...pillStyle, background: '#5a2727', width: '100%' }}>
        Clear History
      </button>
    </div>
  );
}

const pillStyle: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 12, border: 'none',
  fontSize: 11, fontWeight: 600, color: '#fff', cursor: 'pointer',
};

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#888',
  fontSize: 16, cursor: 'pointer', padding: 4,
};

const inputStyle: React.CSSProperties = {
  flex: 1, padding: '6px 10px', background: '#222240',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
  color: '#e0e0e0', fontSize: 12, fontFamily: 'inherit',
};
