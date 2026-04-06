# Guardian / 照妖镜

**Stop blind signing. AI reads your transactions so you don't have to.**

Guardian is a Chrome extension that intercepts every EVM wallet signature request and provides independent risk analysis — before your transaction reaches the wallet.

## What it does

When a dApp asks you to sign something, Guardian:

1. **Intercepts** the request (`eth_sendTransaction`, `eth_signTypedData`)
2. **Decodes** the raw calldata independently — ignores what the dApp UI shows
3. **Scores** the risk (0-100) using heuristic rules + AI analysis
4. **Shows** a clear card: what this transaction actually does, what tokens flow where, and why it might be dangerous

A dApp says "transfer" but the calldata is `approve(unlimited)`? Guardian catches it.

## Architecture

```
dApp → provider-proxy (intercept) → ABI decode → Tier 1 heuristic score
                                                       ↓
                                               Tier 2 AI analysis (LLM)
                                               + GoPlus threat intel
                                               + Etherscan contract info
                                                       ↓
                                               Risk card → user decides
```

**Tier 1** (<200ms, local): ABI decode, EIP-712 pattern matching, token flow, heuristic scoring.

**Tier 2** (1-3s, async): LLM explanation with contract context, threat flags, user history.

## Risk detection

| Pattern | Detection |
|---------|-----------|
| `setApprovalForAll` | +50 score, red card |
| `approve(unlimited)` | +45 score |
| Permit2 batch approval | EIP-712 parser identifies multi-token permit |
| Honeypot / phishing address | GoPlus API cross-check |
| Unknown contract calling auth functions | Always triggers AI analysis |

## Setup

```bash
# Install
npm install

# Dev (hot reload)
npm run dev

# Build
npm run build
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

### API configuration

Guardian needs an OpenAI-compatible API endpoint for Tier 2 AI analysis.

Create `.env.local` in the project root:

```
VITE_OPENAI_API_URL=https://api.openai.com/v1/chat/completions
VITE_OPENAI_API_KEY=sk-your-key-here
```

Or set it in the extension popup settings after install.

## Project structure

```
src/
├── inject/       # provider-proxy — intercepts wallet requests
├── core/         # ABI decoder, risk analyzer, approval scanner
├── ai/           # LLM client, prompt builder
├── intel/        # GoPlus, Etherscan, 4byte, price service
├── background/   # service worker — orchestration pipeline
├── content/      # card renderer (Shadow DOM overlay)
├── ui/           # ScoreGauge, RiskBadge, TokenFlow, ActionBar
├── popup/        # extension popup (React)
├── dashboard/    # approval management dashboard
└── config/       # AI config, contract database
```

## Tech stack

MV3 Chrome Extension + Vite + CRXJS + React + TypeScript + ethers.js

## License

MIT

## Author

[@0xenderzcx](https://x.com/0xenderzcx)
