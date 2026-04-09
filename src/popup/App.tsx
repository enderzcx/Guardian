import React, { useEffect, useState } from 'react';
import type { TxRecord, ProtectionStats } from '@/core/tx-history';
import type { GuardianAuthState } from '@/ai/llm-client';

const RISK_COLORS = { green: '#4ade80', yellow: '#facc15', red: '#f87171' };

const GUEST_AUTH: GuardianAuthState = {
  status: 'guest',
  token: null,
  user: null,
  usage: null,
  lastError: null,
};

export function App(): React.JSX.Element {
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [stats, setStats] = useState<ProtectionStats>({ totalScanned: 0, totalBlocked: 0, highRiskCaught: 0 });
  const [enabled, setEnabled] = useState(true);
  const [auth, setAuth] = useState<GuardianAuthState>(GUEST_AUTH);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    chrome.storage.local.get(['guardian_tx_history', 'guardian_stats', 'guardian_enabled']).then((r) => {
      setHistory((r.guardian_tx_history as TxRecord[]) ?? []);
      setStats((r.guardian_stats as ProtectionStats) ?? { totalScanned: 0, totalBlocked: 0, highRiskCaught: 0 });
      setEnabled(r.guardian_enabled !== false);
    });

    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }).then((response) => {
      if (response?.auth) setAuth(response.auth as GuardianAuthState);
    }).catch(() => {});

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (changes.guardian_tx_history) {
        setHistory((changes.guardian_tx_history.newValue as TxRecord[]) ?? []);
      }
      if (changes.guardian_stats) {
        setStats((changes.guardian_stats.newValue as ProtectionStats) ?? { totalScanned: 0, totalBlocked: 0, highRiskCaught: 0 });
      }
      if (changes.guardian_enabled) {
        setEnabled(changes.guardian_enabled.newValue !== false);
      }
      if (changes.guardian_auth) {
        setAuth((changes.guardian_auth.newValue as GuardianAuthState) ?? GUEST_AUTH);
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const toggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    chrome.storage.local.set({ guardian_enabled: next });
  };

  const clearAll = () => {
    chrome.storage.local.remove(['guardian_tx_history', 'guardian_stats']);
    setHistory([]);
    setStats({ totalScanned: 0, totalBlocked: 0, highRiskCaught: 0 });
  };

  const submitAuth = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password.trim()) {
      setMessage('Email and password are required.');
      return;
    }

    setPending(true);
    setMessage(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: mode === 'login' ? 'AUTH_LOGIN' : 'AUTH_REGISTER',
        email: trimmedEmail,
        password: password.trim(),
      });
      if (response?.ok && response.auth) {
        setAuth(response.auth as GuardianAuthState);
        setPassword('');
        setMessage(mode === 'login' ? 'Signed in.' : 'Account created.');
      } else {
        setMessage((response?.error as string | undefined) ?? 'Authentication failed.');
      }
    } catch {
      setMessage('Authentication failed.');
    } finally {
      setPending(false);
    }
  };

  const refreshAccount = async () => {
    setPending(true);
    setMessage(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'REFRESH_AUTH_STATE' });
      if (response?.auth) {
        setAuth(response.auth as GuardianAuthState);
      }
    } catch {
      setMessage('Could not refresh usage.');
    } finally {
      setPending(false);
    }
  };

  const logout = async () => {
    setPending(true);
    setMessage(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' });
      if (response?.auth) setAuth(response.auth as GuardianAuthState);
      setPassword('');
      setMessage('Signed out.');
    } catch {
      setMessage('Could not sign out.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div style={{ padding: 16, minHeight: 480 }}>
      <Header enabled={enabled} onToggle={toggleEnabled} onSettings={() => setShowSettings(!showSettings)} />

      <AccountBanner auth={auth} />

      <DashboardButton />

      {showSettings ? (
        <Settings
          auth={auth}
          mode={mode}
          setMode={setMode}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          submitAuth={submitAuth}
          refreshAccount={refreshAccount}
          logout={logout}
          clearAll={clearAll}
          pending={pending}
          message={message ?? auth.lastError}
        />
      ) : (
        <>
          <StatsBar stats={stats} />
          <TxList history={history} />
        </>
      )}

      <footer style={{ textAlign: 'center', fontSize: 10, opacity: 0.25, marginTop: 16 }}>
        v0.1.0 | AI is the spine.
      </footer>
    </div>
  );
}

function Header({ enabled, onToggle, onSettings }: {
  enabled: boolean; onToggle: () => void; onSettings: () => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Guardian</div>
        <div style={{ fontSize: 11, opacity: 0.4, marginTop: 2 }}>Wallet protection with account-based AI</div>
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

function AccountBanner({ auth }: { auth: GuardianAuthState }) {
  const usage = auth.usage;
  const usageText = auth.status === 'authenticated'
    ? usage?.remaining === null
      ? 'Unlimited AI'
      : `${usage?.remaining ?? 0} AI runs left today`
    : 'Sign in for AI analysis';

  return (
    <div style={{
      marginBottom: 12,
      padding: '10px 12px',
      borderRadius: 10,
      border: '1px solid rgba(255,255,255,0.08)',
      background: auth.status === 'authenticated'
        ? 'linear-gradient(135deg, rgba(50,80,42,0.9), rgba(26,30,45,0.95))'
        : 'linear-gradient(135deg, rgba(58,45,24,0.92), rgba(26,30,45,0.95))',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
            {auth.status === 'authenticated' ? auth.user?.email : 'AI account not connected'}
          </div>
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
            {usageText}
          </div>
        </div>
        <div style={{
          ...pillStyle,
          cursor: 'default',
          background: auth.status === 'authenticated'
            ? auth.user?.plan === 'paid' ? '#2155a4' : '#2d5a27'
            : '#6b4d1f',
        }}>
          {auth.status === 'authenticated' ? auth.user?.plan?.toUpperCase() : 'GUEST'}
        </div>
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
          {timeStr} {tx.decision === 'rejected' ? 'X' : tx.decision === 'approved' ? 'OK' : '...'}
        </div>
      </div>
    </div>
  );
}

function Settings(props: {
  auth: GuardianAuthState;
  mode: 'login' | 'register';
  setMode: (mode: 'login' | 'register') => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  submitAuth: () => void;
  refreshAccount: () => void;
  logout: () => void;
  clearAll: () => void;
  pending: boolean;
  message: string | null;
}) {
  const {
    auth,
    mode,
    setMode,
    email,
    setEmail,
    password,
    setPassword,
    submitAuth,
    refreshAccount,
    logout,
    clearAll,
    pending,
    message,
  } = props;

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, opacity: 0.6 }}>ACCOUNT</div>

      {auth.status === 'authenticated' ? (
        <div style={panelStyle}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{auth.user?.email}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            Plan: {auth.user?.plan ?? 'free'}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            {auth.usage?.remaining === null
              ? 'Unlimited AI analyses available.'
              : `${auth.usage?.remaining ?? 0} of ${auth.usage?.limit ?? 10} AI analyses left today.`}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={refreshAccount} style={{ ...pillStyle, background: '#2d455a', flex: 1 }} disabled={pending}>
              Refresh
            </button>
            <button onClick={logout} style={{ ...pillStyle, background: '#5a2727', flex: 1 }} disabled={pending}>
              Log Out
            </button>
          </div>
        </div>
      ) : (
        <div style={panelStyle}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setMode('login')}
              style={{ ...pillStyle, flex: 1, background: mode === 'login' ? '#2d455a' : '#2a2a38' }}
            >
              Sign In
            </button>
            <button
              onClick={() => setMode('register')}
              style={{ ...pillStyle, flex: 1, background: mode === 'register' ? '#2d455a' : '#2a2a38' }}
            >
              Create Account
            </button>
          </div>

          <label style={{ fontSize: 11, opacity: 0.5 }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ ...inputStyle, marginTop: 4, marginBottom: 12 }}
          />

          <label style={{ fontSize: 11, opacity: 0.5 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            style={{ ...inputStyle, marginTop: 4 }}
          />

          <button
            onClick={submitAuth}
            style={{ ...pillStyle, background: '#2d5a27', width: '100%', marginTop: 12 }}
            disabled={pending}
          >
            {pending ? 'Working...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </div>
      )}

      {message && (
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 10 }}>
          {message}
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 18, marginBottom: 12, opacity: 0.6 }}>DATA</div>
      <button onClick={clearAll} style={{ ...pillStyle, background: '#5a2727', width: '100%' }}>
        Clear History
      </button>
    </div>
  );
}

const pillStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 12, border: 'none',
  fontSize: 11, fontWeight: 600, color: '#fff', cursor: 'pointer',
};

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#888',
  fontSize: 16, cursor: 'pointer', padding: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#222240',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#e0e0e0',
  fontSize: 12,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const panelStyle: React.CSSProperties = {
  padding: 12,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
};
