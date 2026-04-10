# Guardian / 照妖镜

**Stop blind signing. AI reads your transactions so you don't have to.**

Guardian is a Chrome extension that intercepts every EVM wallet signature request and provides independent risk analysis — before your transaction reaches the wallet.

<p align="center">
  <img src="docs/popup-preview.png" width="360" alt="Guardian popup — transaction history with risk scores" />
</p>

## What it does

When a dApp asks you to sign something, Guardian:

1. **Intercepts** the request (`eth_sendTransaction`, `eth_signTypedData`)
2. **Decodes** the raw calldata independently — ignores what the dApp UI shows
3. **Scores** the risk (0-100) using heuristic rules + AI analysis
4. **Shows** a clear card: what this transaction actually does, what tokens flow where, and why it might be dangerous

A dApp says "transfer" but the calldata is `approve(unlimited)`? Guardian catches it.

## Architecture

```
dApp page
  ↓ wallet request
MAIN world interceptor  (manifest content_script, world=MAIN, run_at=document_start)
  ↓ postMessage (intercept notification only, no secrets)
Content script (ISOLATED world)
  ↓ chrome.runtime
Service worker
  ├── Tier 1: ABI decode + heuristic score  (<200ms, local)
  ├── Tier 2: AI analysis via Guardian API  (1-3s, async)
  │     ├── GoPlus threat intel
  │     ├── Etherscan contract info
  │     └── User history context
  ↓
Risk card (Shadow DOM overlay) → user approves / rejects
  ↓ chrome.runtime → service worker
  ↓ chrome.scripting.executeScript
MAIN world: dispatch private CustomEvent → resolve the wallet promise
```

### Security model

The decision channel is **unforgeable by page scripts**:

- MAIN world interceptor runs at `document_start` via manifest `world: "MAIN"` — beats dApps that cache the provider reference early
- Each tab gets a unique private `CustomEvent` name (`guardian:resolve:<UUID>`), generated in MAIN world and handshaked to the content script
- User decisions flow: content script → service worker → `chrome.scripting.executeScript` dispatches the private event
- Anti-monkey-patch: uses a hidden iframe to obtain pristine `EventTarget` APIs
- Page scripts cannot predict the event name, cannot call `chrome.scripting`, and cannot intercept `chrome.runtime` messages

### Backend architecture

```
Guardian Extension
  → Guardian API   (auth, quota, caching, Infini billing)
    → codex-proxy  (internal AI gateway)
      → upstream model  (GPT-5.4-mini)

Infini Pay webhook → Guardian API /billing/webhook/infini
```

- Extension never holds API keys — only a session JWT
- Server-side response cache + in-flight dedup (no double-charging)
- Tier 1 local analysis always works, even without login
- Billing events and checkout sessions are persisted for audit

## Plans

| Plan  | Price         | Monthly AI quota | Approx. daily |
|-------|---------------|------------------|---------------|
| FREE  | $0            | 100              | ~3            |
| PRO   | 2.9 USDT/mo   | 5,000            | ~166          |
| MAX   | 9.9 USDT/mo   | 20,000           | ~666          |

- Monthly reset, timezone configurable (`GUARDIAN_BILLING_TZ`, default Asia/Shanghai)
- Cached analyses do not consume quota
- Paid plans via Infini Pay subscription (USDT)

## Risk detection

| Pattern | Detection |
|---------|-----------|
| `approve(MAX_UINT256)` | Detected as unlimited, +45 score |
| `setApprovalForAll` | +50 score, red card |
| Permit2 batch approval | EIP-712 parser, pattern-specific risk factors |
| Honeypot / phishing address | GoPlus API cross-check |
| Unverified contract | Etherscan source check + contract age |
| Unknown function calling auth | Always triggers AI |

## Features

- **Early interception** — MAIN world script at `document_start`, catches wallet references before dApps cache them
- **Transaction interception** — wraps `window.ethereum.request()` + EIP-6963 providers
- **ABI decoding** — known fragments + 4byte.directory fallback
- **EIP-712 parsing** — Permit, Permit2, DAI permit, order signatures
- **Heuristic scoring** — local, instant, no network
- **AI analysis** — LLM explanation with full context (contract info, threat intel, user profile)
- **Approval dashboard** — scan active approvals, filter by risk, batch revoke
- **Token flow** — shows what goes out and what comes in, with USD values
- **User accounts** — register/login, monthly quota, Infini subscription billing
- **Accessibility** — ARIA roles on card, gauge, badge, action bar
- **Draggable card** — reposition the overlay card, boundary clamped

## Setup

### Extension

```bash
npm install
npm run dev      # hot reload
npm run build    # production build
```

Load `dist/` as unpacked extension in `chrome://extensions`.

Override the default backend URL for local dev by creating `.env.local`:

```
VITE_GUARDIAN_API_URL=http://127.0.0.1:3300
```

### Guardian API backend

```bash
cd server
cp .env.example .env
# Edit .env: JWT secret, codex-proxy URL/key, Infini credentials

node index.mjs
# Or run under pm2:
pm2 start ecosystem.config.cjs
```

Key environment variables (`server/.env.example`):

- `GUARDIAN_JWT_SECRET` — HMAC secret for session tokens (auto-generated if unset, but non-persistent)
- `GUARDIAN_ADMIN_SECRET` — header secret for `/admin/*` routes
- `GUARDIAN_FREE_MONTHLY_LIMIT` / `PRO_MONTHLY_LIMIT` / `MAX_MONTHLY_LIMIT` — quota per plan
- `GUARDIAN_BILLING_TZ` — monthly reset timezone
- `CODEX_PROXY_URL` / `CODEX_PROXY_API_KEY` — upstream AI gateway
- `INFINI_BASE_URL` / `INFINI_KEY_ID` / `INFINI_SECRET_KEY` / `INFINI_WEBHOOK_SECRET` — Infini Pay credentials
- `GUARDIAN_PUBLIC_BASE_URL` — public URL of the API (used in checkout redirects)

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/health` | Service health |
| POST   | `/auth/register` | Create account, returns JWT |
| POST   | `/auth/login` | Returns JWT + usage + billing |
| GET    | `/me` | Current user + usage + billing |
| GET    | `/usage` | Usage only |
| POST   | `/analyze` | AI analysis (consumes quota) |
| GET    | `/billing/subscription` | Current subscription state |
| POST   | `/billing/checkout` | Create Infini checkout URL for plan |
| POST   | `/billing/cancel` | Cancel at period end |
| POST   | `/billing/webhook/infini` | Infini Pay webhook handler |
| GET    | `/checkout/success` | Checkout success redirect page |
| GET    | `/checkout/failure` | Checkout failure page |
| GET    | `/checkout/cancel` | Checkout canceled page |
| POST   | `/admin/users/plan` | Manual plan override (admin secret required) |

## Project structure

```
src/
├── background/       # service worker — orchestration + decision routing
├── content/          # card renderer (Shadow DOM overlay)
├── inject/
│   └── main-world.ts # early MAIN world interceptor (manifest content_script)
├── core/             # ABI decoder, tier1 analyzer, approval scanner, user profile
├── ai/               # Guardian API client, prompt builder, response cache
├── intel/            # GoPlus, Etherscan, 4byte, price service
├── ui/               # ScoreGauge, RiskBadge, TokenFlow, ActionBar
├── popup/            # extension popup — login/register/plan/history (React)
├── dashboard/        # approval management dashboard (React)
├── utils/            # formatting, EIP-712 parser, rate limiter
└── config/           # AI config, endpoints, contract database
server/
├── index.mjs         # Guardian API backend (single file, stdlib only)
└── .env.example      # env template
test/
├── smoke-extension.mjs        # Playwright e2e smoke for transaction flow
├── smoke-ai.mjs               # AI pipeline smoke test
├── smoke-auth-flow.mjs        # register / login / JWT smoke
├── smoke-billing-flow.mjs     # billing state machine smoke
├── smoke-billing-browser.mjs  # Playwright billing UI smoke
├── smoke-billing-refresh.mjs  # usage/quota refresh smoke
├── test-dapp.html             # local test dApp with mock wallet
└── test-decode.ts             # ABI decoder unit tests
```

## Tech stack

- **Extension**: MV3 + Vite + CRXJS + React + TypeScript + ethers.js
- **Backend**: Node.js (zero dependencies, stdlib only)
- **AI**: GPT-5.4-mini via OpenAI-compatible proxy
- **Intel**: GoPlus Security API + Etherscan + CoinGecko + 4byte.directory
- **Billing**: Infini Pay USDT subscriptions
- **Testing**: Playwright (e2e smoke suite)

## Deployment

Production deployment on VPS:

- `guardian-api` runs under pm2 on port 3300
- nginx reverse proxy: `https://enderzcxai.duckdns.org/guardian/`
- `codex-proxy` as internal AI gateway on `127.0.0.1:8080`
- Data persisted to `server-data/users.json` (includes users, checkout sessions, billing events)

## Roadmap

- [x] Stage 0-6: Core extension (intercept, decode, score, AI, UI, e2e)
- [x] Security hardening (decision channel, cache, scoring, JWT default secret)
- [x] Auth system + Guardian API backend
- [x] Monthly quota model (free/pro/max)
- [x] Infini Pay subscription billing
- [x] Early MAIN-world interception (document_start)
- [x] VPS deployment
- [ ] Landing page
- [ ] Chrome Web Store publish
- [ ] Multi-chain support
- [ ] Full AI Native wallet (Phase 2)

## License

MIT

## Author

[@0xenderzcx](https://x.com/0xenderzcx)
