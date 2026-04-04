import React, { useEffect, useState } from 'react';
import type { ActiveApproval } from '@/core/approval-scanner';

const RISK_COLORS = { green: '#4ade80', yellow: '#facc15', red: '#f87171' };
const RISK_BG = { green: '#1a2e1a', yellow: '#2e2a1a', red: '#2e1a1a' };

type Filter = 'all' | 'red' | 'yellow' | 'green';

export function Dashboard(): React.JSX.Element {
  const [approvals, setApprovals] = useState<ActiveApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [address, setAddress] = useState('');

  useEffect(() => {
    loadApprovals();
  }, []);

  async function loadApprovals() {
    setLoading(true);
    setError('');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SCAN_APPROVALS' });
      if (response?.error) {
        setError(response.error);
      } else {
        setApprovals(response?.approvals ?? []);
        setAddress(response?.address ?? '');
      }
    } catch (e) {
      setError('Failed to connect to Guardian extension');
    }
    setLoading(false);
  }

  async function handleRevoke(approval: ActiveApproval) {
    const key = `${approval.token}:${approval.spender}`;
    setRevoking(key);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REVOKE_APPROVAL',
        approval,
      });
      if (response?.ok) {
        setApprovals((prev) => prev.filter((a) =>
          `${a.token}:${a.spender}`.toLowerCase() !== key.toLowerCase()
        ));
      }
    } catch {}
    setRevoking(null);
  }

  const filtered = filter === 'all'
    ? approvals
    : approvals.filter((a) => a.riskLevel === filter);

  const counts = {
    all: approvals.length,
    red: approvals.filter((a) => a.riskLevel === 'red').length,
    yellow: approvals.filter((a) => a.riskLevel === 'yellow').length,
    green: approvals.filter((a) => a.riskLevel === 'green').length,
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
      <Header address={address} onRefresh={loadApprovals} loading={loading} />

      {error && <ErrorBar message={error} />}

      <FilterBar filter={filter} setFilter={setFilter} counts={counts} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, opacity: 0.4 }}>
          Scanning approvals...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, opacity: 0.4 }}>
          {approvals.length === 0 ? 'No active approvals found.' : 'No approvals match this filter.'}
        </div>
      ) : (
        <div>
          {filtered.map((a) => (
            <ApprovalRow
              key={`${a.token}:${a.spender}`}
              approval={a}
              onRevoke={() => handleRevoke(a)}
              revoking={revoking === `${a.token}:${a.spender}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Header({ address, onRefresh, loading }: {
  address: string; onRefresh: () => void; loading: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>
          Approval Dashboard
        </h1>
        <div style={{ fontSize: 12, opacity: 0.4, marginTop: 4 }}>
          Guardian 照妖镜 {address ? `— ${address.slice(0, 6)}...${address.slice(-4)}` : ''}
        </div>
      </div>
      <button onClick={onRefresh} disabled={loading} style={{
        padding: '8px 20px', borderRadius: 8, border: 'none',
        background: '#222240', color: '#e0e0e0', cursor: 'pointer',
        fontSize: 13, opacity: loading ? 0.5 : 1,
      }}>
        {loading ? 'Scanning...' : 'Refresh'}
      </button>
    </div>
  );
}

function ErrorBar({ message }: { message: string }) {
  return (
    <div style={{
      padding: '10px 16px', marginBottom: 16, borderRadius: 8,
      background: '#2e1a1a', border: '1px solid #5a2727',
      fontSize: 13, color: '#f87171',
    }}>
      {message}
    </div>
  );
}

function FilterBar({ filter, setFilter, counts }: {
  filter: Filter; setFilter: (f: Filter) => void;
  counts: Record<Filter, number>;
}) {
  const tabs: { key: Filter; label: string; color?: string }[] = [
    { key: 'all', label: `All (${counts.all})` },
    { key: 'red', label: `Danger (${counts.red})`, color: '#f87171' },
    { key: 'yellow', label: `Caution (${counts.yellow})`, color: '#facc15' },
    { key: 'green', label: `Safe (${counts.green})`, color: '#4ade80' },
  ];

  return (
    <div style={{
      display: 'flex', gap: 8, marginBottom: 20,
      borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 12,
    }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => setFilter(t.key)}
          style={{
            padding: '6px 14px', borderRadius: 6, border: 'none',
            fontSize: 12, fontWeight: 500, cursor: 'pointer',
            background: filter === t.key ? (t.color ? t.color + '22' : '#333') : 'transparent',
            color: filter === t.key ? (t.color ?? '#fff') : '#888',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ApprovalRow({ approval, onRevoke, revoking }: {
  approval: ActiveApproval; onRevoke: () => void; revoking: boolean;
}) {
  const color = RISK_COLORS[approval.riskLevel];
  const bg = RISK_BG[approval.riskLevel];
  const age = formatAge(approval.timestamp);
  const typeLabel = approval.type === 'nft-all' ? 'NFT Collection' : 'ERC-20';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 16px', marginBottom: 8, borderRadius: 10,
      background: '#1a1a2e', border: `1px solid ${color}22`,
    }}>
      {/* Risk dot */}
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: color, flexShrink: 0,
      }} />

      {/* Token info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#fff' }}>
            {approval.tokenName}
          </span>
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4,
            background: bg, color, fontWeight: 500,
          }}>
            {typeLabel}
          </span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
          Spender: {approval.spenderName}
        </div>
      </div>

      {/* Amount */}
      <div style={{ textAlign: 'right', minWidth: 90 }}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: approval.isUnlimited ? color : '#e0e0e0',
        }}>
          {approval.isUnlimited ? 'UNLIMITED' : truncateAmount(approval.amount)}
        </div>
        <div style={{ fontSize: 10, opacity: 0.35, marginTop: 2 }}>
          {age}
        </div>
      </div>

      {/* Revoke button */}
      <button
        onClick={onRevoke}
        disabled={revoking}
        style={{
          padding: '6px 16px', borderRadius: 6, border: 'none',
          background: '#5a2727', color: '#fff', cursor: 'pointer',
          fontSize: 12, fontWeight: 500, opacity: revoking ? 0.5 : 1,
          minWidth: 70,
        }}
      >
        {revoking ? '...' : 'Revoke'}
      </button>
    </div>
  );
}

function formatAge(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function truncateAmount(amount: string): string {
  if (amount.length <= 10) return amount;
  return amount.slice(0, 8) + '...';
}
