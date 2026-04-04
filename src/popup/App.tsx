import React from 'react';

export function App(): React.JSX.Element {
  return (
    <div style={{ padding: 24 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: '#fff' }}>
          Guardian
        </h1>
        <p style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
          照妖镜 — AI reads your transactions
        </p>
      </header>

      <section>
        <h2 style={{ fontSize: 13, opacity: 0.4, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
          Recent Transactions
        </h2>
        <div style={{
          padding: 32,
          textAlign: 'center',
          opacity: 0.3,
          fontSize: 14,
        }}>
          No transactions yet.
          <br />
          Guardian will appear when you sign.
        </div>
      </section>

      <footer style={{
        position: 'absolute',
        bottom: 16,
        left: 24,
        right: 24,
        textAlign: 'center',
        fontSize: 11,
        opacity: 0.3,
      }}>
        v0.1.0 — AI is the spine.
      </footer>
    </div>
  );
}
