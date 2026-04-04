# Guardian / 照妖镜 — Project Proposal

> **Date**: 2026-04-03
> **Author**: 0xEnder (@0xenderzcx)
> **Status**: Pre-MVP / Research Complete
> **English**: Guardian
> **中文**: 照妖镜 — 照出每笔交易的真面目

---

## 1. Executive Summary

Guardian (照妖镜) is a Chrome browser extension that intercepts every Ethereum/EVM wallet signature request and provides AI-powered analysis through a **two-tier architecture**:

1. **Tier 1 Fast Scan (<200ms, local)**: ABI decode + transaction simulation + AI risk scoring → instant token flow + risk color
2. **Tier 2 AI Deep Analysis (1-3s, async)**: LLM-generated natural language explanation + 0-100 risk score

**Core differentiation**: No product on the market uses LLM for per-transaction semantic explanation. Existing solutions tell you WHAT (token flow). We tell you WHY (why it's risky).

**AI is not a feature. AI is the spine.** — AI penetrates every layer of Guardian's decision-making, from risk scoring to trigger logic to personalized explanation.

**Dual purpose**:
- For users: solve real EthUX pain points today, before protocol-level standards arrive
- For builder: demonstrate blockchain + AI + product taste capabilities

---

## 2. Problem (EthUX Pain Points)

Guardian directly addresses 6 pain points from the [EthUX Pain Map](https://ethux.design/) (Ethereum Foundation initiative):

### 2.1 Blind Signing (Critical, In-Progress)
- Users approve transactions they can't read — the #1 phishing attack vector
- $84M stolen by wallet drainers in 2025
- Even hardware wallets display raw hex data
- **Existing solutions**: Transaction simulation (Live), ERC-7730 clear signing (Draft, limited coverage), EIP-712 (Live)
- **Gap**: Simulation shows WHAT happens; nobody explains WHY it's risky

### 2.2 Blanket Warnings (Medium, UNSOLVED)
- $50 swap and $50,000 unlimited approve trigger the same warning
- Users trained to "click confirm blindly" → warning fatigue
- **Existing solutions**: "Contextual risk scoring — Building" (Blockaid, Blowfish B2B only)
- **Gap**: Zero B2C products doing risk-graded warnings

### 2.3 Signing Fatigue (High, In-Progress)
- Every wallet interaction = signature prompt. Login, approve, execute, sign again
- Volume of prompts trains users to approve without reading
- **Existing solutions**: EIP-5792 batched calls (Final), Session keys ERC-7715 (Draft)
- **Gap**: Standards require wallet + dApp adoption; Guardian reduces noise NOW with smart trigger

### 2.4 Token Approval Management (High, In-Progress)
- Unlimited approvals by default, no expiry, users forget they exist
- "$300K lost in 10 minutes from a stale token approval" — industry report, March 2026
- **Existing solutions**: Revoke.cash (Live), In-wallet revocation (starting)
- **Gap**: No product proactively warns about stale/risky approvals with AI context

### 2.5 Missing Signing Context (Medium, In-Progress)
- Multi-step flows (approve → permit → execute) shown as isolated prompts
- Users either rubber-stamp everything or abandon mid-flow
- **Existing solutions**: EIP-5792 (Final), ERC-7730 (Draft), ERC-7715 (Draft)
- **Gap**: Standards not adopted yet; Guardian adds context NOW via AI

### 2.6 Prevalence of Scams (Critical, In-Progress)
- Phishing attacks, address poisoning, spoofed domains
- Users search for help and find impersonator support channels
- **Existing solutions**: Transaction simulation (Live), Address poisoning detection (Building)
- **Gap**: Pre-transaction page-level detection + natural language risk explanation

---

## 3. Positioning & Moat

### 3.1 The Bridge Layer

> **Guardian is the AI bridge layer before protocol-level standards arrive.**
>
> ERC-7730 clear signing needs dApp adoption. EIP-5792 batching needs wallet support. ERC-7715 session keys are still Draft. Users can't wait. Guardian solves these problems NOW at the application layer with AI. When these standards eventually mature, Guardian has already accumulated users and data to become the verification/complement layer.

### 3.2 Moat Analysis

**Short-term (0-6 months): Speed + Taste**
- No competitor uses LLM for transaction explanation. Zero.
- Product taste (UI quality, interaction design) can't be copied
- MetaMask needs product committees, legal review, 3 rounds of approval → their process is our time window

**Mid-term (6-18 months): Data Flywheel**
- Every AI analysis + user action (approve/reject/force approve) = labeled training data
- User behavior IS annotation data — no extra effort required
- At 10K+ labels: fine-tune a specialized model, faster and more accurate than generic LLM
- This dataset doesn't exist anywhere else

**Long-term (18+ months): Community Trust**
- Security products live on trust. Users don't casually install extensions that intercept all transactions
- "Guardian saved me $X" organic CT narratives > any technical moat
- North Star Metric "Scam $ Prevented" doubles as product metric AND viral content

### 3.3 Competitive Landscape (2026-04)

**Dead/Acquired (2023-2025)**:
| Company | Funding | Outcome |
|---|---|---|
| Stelo | $6M (a16z) | 2023.10 shutdown — template-based, not AI, no PMF |
| Wallet Guard | Open source | 2025.3 sunset |
| Fire | - | 2024 acquired by Kerberus |
| Pocket Universe | - | 2025.8 acquired by Kerberus |
| Blowfish | $11.8M | 2024.11 acquired by Phantom |

**Active Players**:
| Company | Position | Scale | Uses AI/LLM? |
|---|---|---|---|
| Blockaid | B2B security infra | $83M raised, 20M+ users covered | ML detection, no LLM |
| Rabby | Best native wallet simulation | 4.2M installs | No AI |
| Kerberus Sentinel3 | B2C extension consolidator | 250K users | Rule engine |
| CryptoGuard (ChainGPT) | "AI" extension | 1K+ users | Small custom model, weak |
| MetaMask + Blockaid | Built-in security warnings | 30M users | Binary safe/danger |

**The gap: No product uses LLM for transaction explanation. Zero.**

### 3.4 vs Stelo (Why We Won't Repeat Their Fate)

| | Stelo (dead) | Guardian |
|---|---|---|
| Explanation engine | Pre-written templates | LLM via Codex relay |
| Risk scoring | None | AI-powered 0-100 |
| Multilingual | English only | LLM-native multilingual |
| Unknown contracts | Shows "unknown" | AI infers intent |
| LLM cost | N/A (2022: too expensive) | ~$0 (Codex proxy) |
| Timing | 2022 (too early) | 2026 (LLM cheap + fast) |
| Approach | AI as feature | AI as spine |

---

## 4. AI Native Architecture

### 4.1 Design Principle: AI is the Spine

```
NOT this:                          THIS:
┌──────────────┐                   ┌──────────────────────────────┐
│  Rule engine │                   │           Guardian            │
│  + AI button │                   │                              │
│  at the end  │                   │  Page detection ←── AI       │
└──────────────┘                   │  Risk scoring   ←── AI       │
                                   │  Trigger logic  ←── AI       │
                                   │  Explanation    ←── AI       │
                                   │  User profiling ←── AI       │
                                   │  Health checks  ←── AI       │
                                   │  Data flywheel  ←── AI       │
                                   │                              │
                                   │  AI is not a feature.        │
                                   │  AI is the spine.            │
                                   └──────────────────────────────┘
```

### 4.2 AI Levels

**MVP (Level 1-3)**:

| Level | What AI Does | Replaces |
|---|---|---|
| **L1: AI Risk Scoring** | Synthesize all data signals into 0-100 score | Static rule engine |
| **L2: AI Smart Trigger** | Decide whether Tier 2 deep analysis is needed | if-else trigger rules |
| **L3: Personalized Explanation** | Generate context-aware natural language | Template strings |

**V1.1+ (Level 4-5)**:

| Level | What AI Does | When |
|---|---|---|
| **L4: Approval Health Diagnosis** | Periodic background scan of active approvals | V1.1 |
| **L5: Phishing Page Detection** | Analyze page content + structure for scam patterns | V1.2 |

#### L1: AI Risk Scoring (replaces rule engine)

```
Rule engine (brittle):              AI scoring (contextual):
if unknown_contract: +40            "Contract: unverified, 3 days old,
if unlimited_approve: +30           BUT 2000 unique callers, $5M TVL
if age < 7 days: +20               on DefiLlama, owner is multisig."
→ Score: 90 (false alarm)           → Score: 25 (new but legitimate)
```

#### L2: AI Smart Trigger (replaces if-else)

```
"User did 47 swaps on Uniswap in 30 days.
 This is another Uniswap swap, $100."
→ AI: Skip Tier 2. Routine operation.

"User never interacted with this contract.
 No source code. Requests setApprovalForAll."
→ AI: Immediate Tier 2 + pre-warning.
```

Estimated: only ~30% of signatures need Tier 2 AI analysis.

#### L3: Personalized Explanation

```
For newcomer (< 10 lifetime txs):
"This will let the Uniswap app swap your tokens.
 It's like giving a store permission to charge your card.
 Uniswap is one of the most trusted apps in crypto."

For power user (1000+ txs):
"swapExactTokensForTokens via UniV3 Router.
 Route: USDC→WETH, 0.3% pool. Normal."
```

User profile derived from on-chain history (tx count, active duration, protocol diversity). Queried once at install, cached.

### 4.3 Data Sources (Three Layers)

**Layer 1: Transaction-level (available at signing)**
```
├── calldata (raw hex)
├── to address (target contract)
├── value (ETH amount)
├── from address (user)
├── gas / gasPrice
└── EIP-712: complete typed data structure
```

**Layer 2: On-chain (free / low-cost, queried in parallel)**
```
├── Contract source code → Etherscan API / Sourcify
├── Contract creation time
├── Contract verified status
├── Contract TVL / interaction volume → DefiLlama API
├── Contract owner → read storage or owner()
├── User's approval status → allowance()
├── User balance → balanceOf()
├── User's active approvals → event logs
├── Token metadata → name, symbol, decimals
└── Recent contract caller count → event logs
```

**Layer 3: Off-chain intelligence (APIs)**
```
├── GoPlus Security API (free)
│   ├── Open source check, honeypot detection
│   ├── Owner privileges (mint/pause/blacklist)
│   ├── Buy/sell tax rates
│   └── Malicious address flags
├── Scamsniffer / ChainAbuse → known phishing addresses
├── 4byte.directory → function signature lookup
├── Domain intelligence → Whois, SSL, similar domain detection
├── Price data → CoinGecko / DexScreener (USD value + price deviation)
└── Community data (V2) → CT mentions, Etherscan labels, Arkham
```

### 4.4 Data Flywheel

```
User signs → Guardian analyzes → User acts (approve/reject/force)
                                         ↓
                                 Implicit labeled data
                                         ↓
                                 AI accuracy improves
                                         ↓
                                 Users trust Guardian more
                                         ↓
                                 More users → more data → ...
```

- User clicks "Force Approve" on Red Card → possible false positive → negative feedback
- User clicks "Reject" on Yellow Card → user agrees with risk → positive feedback
- User instantly approves Green Card → analysis was correct → confidence +1

**User behavior IS annotation data.** No extra effort required.

### 4.5 Two-Tier Analysis Flow

```
dApp initiates transaction → Extension intercepts eth_sendTransaction
│
├── Tier 1: Fast Scan (<200ms, LOCAL)
│   ├── ABI decode calldata (10ms, ethers.js + 4byte cache)
│   ├── Check known contract DB (5ms, IndexedDB)
│   ├── eth_call simulate (100-150ms, user's RPC)
│   ├── AI risk scoring (5ms, local lightweight model or prompt)
│   └── → Display Quick Card: token in/out + risk color
│
├── AI Smart Trigger: need Tier 2?
│   ├── AI evaluates: transaction context + user history + risk signals
│   ├── ~70% of signatures: Skip (routine, known, low-value)
│   └── ~30% of signatures: Trigger Tier 2
│
└── Tier 2: AI Deep Analysis (1-3s, ASYNC)
    ├── Fetch contract source (200ms, Etherscan/Sourcify)
    ├── Check threat DBs (300ms, GoPlus + custom, parallel)
    ├── Construct rich prompt with all 3 data layers (50ms)
    ├── LLM inference (500ms-2s, via Codex proxy)
    └── → Update card: personalized AI explanation + 0-100 score
```

### 4.6 Latency Budget

```
User perception timeline:
0ms        Quick Card appears (token flow + risk color)
200ms      User starts reading Quick Card
200ms-1s   "AI analyzing..." animation
1-3s       AI explanation fades in (sentence by sentence)
2-5s       User finishes reading Quick Card → AI already loaded
```

User's reading time (2-5s) > AI response time (1-3s). **User perceives no delay.**

---

## 5. Product Scope (Extension Phase)

### 5.1 Four Product Layers

**Layer 1: Transaction Guardian (MVP core)**
- Intercept eth_sendTransaction + eth_signTypedData
- Tier 1/Tier 2 dual analysis
- Green/Yellow/Red Card UI
- Actionable options (Set Exact Amount, Revoke, etc.)

**Layer 2: Page Awareness (MVP, lightweight)**
- Domain reputation check on dApp page load
- Risk banner injection for suspicious sites
- Whois age, SSL, known phishing list, similar domain detection

**Layer 3: Approval Dashboard (V1.1)**
- Side Panel: all active approvals with AI health assessment
- One-click revoke with gas estimate
- Transaction history with AI scores
- Protection Stats: "Total Protected: $X,XXX"

**Layer 4: dApp Enhancement (V1.2, stretch)**
- Inject contextual info on DEX pages (price impact, CEX comparison)
- Contract reputation badges
- Address labels (known scammer / whale / etc.)

### 5.2 UI States

**Green Card (Score 0-30)**:
```
┌─────────────────────────────────────┐
│  ● Uniswap V3 Swap           8     │
│                                     │
│  You send   100 USDC    ($100.00)   │
│  You get    0.0512 ETH  ($99.71)    │
│  Slippage   0.29%                   │
│  Gas        ~$0.03                  │
│                                     │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│  🤖 Standard swap on verified       │
│  contract ($2.1B TVL). Normal.      │
│                                     │
│  [Approve]                [Reject]  │
└─────────────────────────────────────┘
```

**Yellow Card (Score 31-70)**:
```
┌─────────────────────────────────────┐
│  ◉ Token Approval              58   │
│                                     │
│  APPROVE   Unlimited USDC          │
│  TO        0x7B2...f3 (unknown)    │
│  Contract  3 days old · No source  │
│                                     │
│  ⚠ This contract can spend ALL     │
│    your USDC with no limit.        │
│                                     │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│  🤖 Unverified contract, deployed   │
│  3 days ago with no audit.         │
│  Consider setting exact amount     │
│  (e.g. 100 USDC) instead.         │
│                                     │
│  [Set Exact] [Approve]  [Reject]   │
└─────────────────────────────────────┘
```

**Red Card (Score 71-100)**:
```
┌─────────────────────────────────────┐
│  ◉ HIGH RISK                   92   │
│                                     │
│  ⚠ Known threat pattern             │
│                                     │
│  setApprovalForAll on your NFTs    │
│  TO  0xdEaD... (flagged, 3 sources)│
│                                     │
│  🤖 This address matches a known    │
│  NFT drainer. 47 wallets drained,  │
│  $230K stolen in 72 hours. This    │
│  would give full control of ALL    │
│  your NFTs.                        │
│                                     │
│  [Details]      [Force Approve ━━━] │
│                 hold 3s to confirm  │
└─────────────────────────────────────┘
```

**EIP-712 Permit Card**:
```
┌─────────────────────────────────────┐
│  ◉ Permit Signature            55   │
│                                     │
│  TYPE     Permit2 — Token Permission│
│  TOKEN    USDC                      │
│  AMOUNT   Unlimited                 │
│  SPENDER  0xAb3... (unknown)        │
│  EXPIRES  30 days                   │
│                                     │
│  ⚠ Off-chain signature. No gas,    │
│    but grants real permissions.     │
│                                     │
│  🤖 Off-chain Permit2 for unlimited │
│  USDC to unverified address. Unlike │
│  on-chain approvals, this won't    │
│  appear in your TX history. Common │
│  phishing vector.                  │
│                                     │
│  [Reject]                  [Sign]   │
└─────────────────────────────────────┘
```

### 5.3 Design Philosophy

- **Overlay** (shadow DOM injection), not popup window — seamless with dApp
- **Dark theme** default — crypto user aesthetic consensus
- **Clean, restrained, professional** — no neon, no gradients, no pixel art
- Card slides in from bottom with physics-based spring animation
- AI text fades in sentence by sentence — feels like AI is "thinking then speaking"
- Risk score: arc gauge with smooth color gradient, not just a number
- Red Card "Force Approve" requires 3s long press — intentional friction
- Auto-adapts to system light/dark mode

---

## 6. Tech Stack

| Layer | Technology | Source |
|---|---|---|
| Chrome Extension | MV3, React, Content Script (MAIN world) | New |
| RPC Interceptor | window.ethereum proxy injection | New |
| ABI Decoder | ethers.js + 4byte.directory cache | Partial |
| TX Simulator | eth_call via user's RPC | New |
| Known Contract DB | IndexedDB (top 500 contracts) | New |
| Backend API | Node.js + Express | RIFI architecture |
| Threat Intelligence | GoPlus API + Scamsniffer + custom blacklist | New |
| LLM Primary | GPT-5.4 via Codex Proxy | Codex relay |
| LLM Fallback | Claude Haiku ($0.25/1M input) | Existing API |
| Response Cache | Same contract + method signature → template | New |
| Price Data | CoinGecko / DexScreener API | New |
| Domain Intel | Whois + SSL + similar domain detection | New |

### 6.1 LLM Infrastructure

```
Primary:   Codex Proxy → GPT-5.4
Fallback:  Claude Haiku API (cheapest, fastest)
Cache:     Same contract + same method → template + dynamic params
```

**Cost estimate**:
- 1000 DAU x 5 signatures x 30% trigger = 1500 AI calls/day
- ~1000 tokens/call → 1.5M tokens/day
- Via Codex proxy: ~$0/day
- Via Claude Haiku fallback: ~$0.38/day

### 6.2 Privacy Design

```
Tier 1: 100% local — zero data leakage
Tier 2: User-configurable
  ├── Mode A (default): Anonymized — strip user address, send contract+method only
  ├── Mode B: Full local — use cached templates, lower accuracy
  └── Mode C: Full send — user opt-in for best AI analysis
```

### 6.3 Key Technical Risks

```
Content Script must inject in MAIN world before any page JS:
  chrome.scripting.registerContentScripts([{
    world: "MAIN",
    runAt: "document_start"
  }])

Wallet compatibility:
  - MetaMask also injects window.ethereum → execution order matters
  - EIP-6963 provider discovery → some dApps don't use window.ethereum
  - Rabby rewrites provider → must hook the final provider
```

---

## 7. Business Model

### 7.1 Revenue Streams

| Model | Pricing | Target |
|---|---|---|
| Free Tier | 10 AI analyses/day, unlimited Tier 1 | User acquisition |
| Pro | $9.9/month, unlimited AI + priority + history + dashboard | Power users |
| B2B SDK | $0.001/API call, min $99/month | Wallets/dApps |
| Insurance (V2) | $30K coverage, fee TBD | Premium users |

### 7.2 Unit Economics

| Metric | Value |
|---|---|
| CAC (organic) | ~$0-2 |
| C2C Pro ARPU | ~$8/month |
| C2C Pro LTV (6mo avg) | ~$48 |
| B2B SDK ARPU | ~$300/month |
| B2B SDK LTV (18mo) | ~$5,400 |
| Marginal cost per AI call | ~$0 (Codex proxy) |
| Monthly infra cost | <$200 |
| Breakeven | 20 Pro users OR 1 B2B client |

---

## 8. Value Proposition

### One-liner
> "Stop blind signing. AI reads your transactions so you don't have to."

### 中文
> "照出每笔交易的真面目"

### Full Statement
> For DeFi users who sign transactions they can't fully understand, Guardian is a browser extension that explains every transaction in plain language with contextual risk scoring. Unlike Rabby (simulation only) and Blockaid (binary warnings), we use AI to tell you WHY a transaction is risky — not just WHAT it does.

### For B2B
> "Add AI-powered transaction explanation to your wallet in 3 lines of code."

### For Non-English Users
> "The first transaction security tool that speaks your language — automatically."

---

## 9. Risk Assessment

### 9.1 Critical Risks (Must Validate First)

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| V1 | Users don't find AI explanation more useful than token flow | Fatal | A/B test with 50 users |
| F1 | Chrome MV3 can't reliably intercept RPC calls | Fatal | PoC in Week 1 |
| F2 | LLM accuracy <90% on TX explanation | Fatal | 100-TX benchmark |
| E4 | AI vulnerable to prompt injection via contract metadata | High | Strict prompt sandboxing |
| B5 | "AI suggests reject" = financial advice liability | Fatal | Information only, not recommendation. "Paused for review" not "BLOCKED" |

### 9.2 Strategic Risks

| # | Risk | Likelihood | Response |
|---|---|---|---|
| S1 | Blockaid adds LLM explanation | Medium | They're B2B infra DNA, not UX. Our moat is taste + B2C trust |
| S2 | Wallets build native AI | Medium | Pivot to B2B SDK / their process is our time window |
| S3 | Codex proxy instability | High | Claude Haiku fallback + response cache |
| S4 | Protocol standards (ERC-7730, EIP-5792) mature quickly | Low | Become verification/complement layer, not competitor |

---

## 10. Roadmap

### Phase 1: Extension (照妖镜 Chrome Extension)

**Week 1-2: Technical Feasibility + Core**
```
Day 1-2: Chrome MV3 PoC — intercept eth_sendTransaction [F1]
         Test: MetaMask, Rabby, EIP-6963 compatibility
Day 3-4: 100-TX benchmark — LLM explanation accuracy [F2]
Day 5:   Codex proxy stress test — 100 concurrent [F3]
Day 5:   Prompt injection test — malicious contract metadata [E4]
Day 6-7: Tier 1 pipeline: ABI decode + eth_call + AI scoring
Day 8-10: Card UI: Green/Yellow/Red with overlay injection
```

**Week 3-4: MVP Complete**
```
- Tier 2 AI integration (Codex proxy + rich prompt)
- AI Smart Trigger (L2)
- Personalized explanation (L3) — newcomer vs power user
- Page risk banner (lightweight domain check)
- Basic popup (last 5 transactions + scores)
```

**Week 5-6: V1.1 Polish**
```
- Approval Dashboard (Side Panel) + one-click revoke
- Protection Stats ("Saved $X")
- Multi-language support
- Transaction history with AI scores
- Pro tier paywall
```

**Week 7-8: V1.2 Launch**
```
- dApp page enhancement injection
- Approval expiry notifications
- Chrome Web Store publish
- Build in Public: CT weekly updates
```

### Phase 2: Wallet (Future)

Guardian core engine wraps into a full AI Native wallet:
- Key management via Privy/Turnkey (passkey, no seed phrase)
- Full EthUX pain map coverage (all 8 categories)
- Guardian becomes the wallet's security/explanation layer

---

## 11. North Star Metric

**Scam $ Prevented** — total dollar value of scams blocked by AI

Why:
- Quantifiable, shareable ("Guardian has saved users $1.2M")
- Directly measures core product value
- CT viral content material
- Visible to users in Protection Stats dashboard

Supporting metrics:
- DAU
- AI trigger rate (~30%)
- Red-flag reject rate (>70%)
- False positive rate (<5%)
- 7-day retention (>40%)
- MRR

---

## Appendix A: Lean Canvas

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│  PROBLEM     │  SOLUTION    │  UVP         │  UNFAIR ADV  │  SEGMENTS    │
│              │              │              │              │              │
│ 1.Blind sign │ 1.AI Risk    │ "AI explains │ 1.Data       │ 1.DeFi degens│
│ 2.Blanket    │   Scoring    │  the WHY,    │   flywheel   │ 2.Newcomers  │
│   warnings   │ 2.Smart      │  not just    │ 2.Product    │ 3.B2B wallets│
│ 3.Signing    │   Trigger    │  the WHAT"   │   taste      │ 4.Non-English│
│   fatigue    │ 3.Personal   │              │ 3.Speed to   │   users      │
│ 4.Approval   │   Explain    │  AI is the   │   market     │              │
│   mgmt       │ 4.Page Scan  │  spine, not  │ 4.Community  │              │
│ 5.No context │ 5.Dashboard  │  a feature.  │   trust      │              │
│ 6.Scams      │              │              │              │              │
├──────────────┼──────────────┴──────────────┴──────────────┼──────────────┤
│  KEY METRICS │                  CHANNELS                  │  COST        │
│              │                                            │              │
│ North Star:  │ 1. Crypto Twitter (Build in Public)        │ LLM: ~$0     │
│ Scam $       │ 2. Product Hunt launch                     │ Server: $50  │
│ Prevented    │ 3. DeFi Discord/Telegram                   │ Intel: $50   │
│              │ 4. KOL partnerships                        │ Total: <$200 │
│ DAU, AI rate │ 5. Chrome Web Store SEO                    │              │
│ FP rate      │ 6. B2B wallet outreach                     │              │
│ Retention    │ 7. EthUX community                         │              │
├──────────────┼────────────────────────────────────────────┤              │
│  REVENUE     │                                            │              │
│              │                                            │              │
│ Free: 10/day │                                            │              │
│ Pro: $9.9/mo │                                            │              │
│ B2B: $0.001  │                                            │              │
│ Insurance V2 │                                            │              │
└──────────────┴────────────────────────────────────────────┴──────────────┘
```

---

## Appendix B: Figma Diagrams

Architecture and flow diagrams available in Figma:
1. A. AI Transaction Guardian - Architecture
2. A. Transaction Guardian - User Flow
3. B. Natural Language Wallet - Architecture (alternative direction)
4. B. NL Wallet - User Flow
5. C. Smart Risk Shield - Architecture (alternative direction)
6. C. Risk Shield - Integration Flow
7. Tiered Analysis Architecture
8. Analysis Latency Timeline
9. Transaction Security - Market Map 2026
