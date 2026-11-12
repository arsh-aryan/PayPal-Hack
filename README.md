# Leash — a firewall between AI agents and your PayPal wallet

AI agents are starting to shop and pay for us. But an agent that can spend money can also be **confused, over-eager, or hijacked** by text hidden in a web page ("prompt injection"). Leash sits between any agent and PayPal: every payment the agent attempts is checked, explained, and either **allowed**, **blocked**, or **sent to you for one-tap approval** — with a full audit trail.

> Built for the PayPal AI Hackathon — *Build what's next with PayPal and AI*.

## How it works

```
 You (plain English mandate)
        │
        ▼
 ① Policy compiler (OpenAI, structured output) ──► enforceable spending policy
        │
        ▼
 ② Shopping agent (OpenAI tool-calling) ── search / read pages / pay()
        │                                              │
        │                         every pay() is intercepted
        ▼                                              ▼
 ③ Leash firewall ─┬─ Layer 1: hard rules (budget, payee, price, returns, category)
                   └─ Layer 2: AI judge (intent match + prompt-injection detection)
        │
   ALLOW ──────────────► PayPal Payouts API (sandbox) ─► payout batch id + status
   REVIEW ─► you approve/deny in the UI ─► PayPal or stop
   BLOCK ──► nothing is sent; agent is told why
        │
        ▼
 ④ Audit trail (AG Grid): every attempt, decision, layer, reason, PayPal id
```

**Security model: the AI never approves money on its own.** Hard rules are the real protection — they can't be talked out of a limit. The AI judge sits on top and can only make a decision *stricter*: it can never approve something the rules reject, it may block outright only when it detects prompt injection, and otherwise it can only escalate to you. The judge only sees the user's mandate and the evidence the agent read — never the agent's own instructions — so it treats page content as untrusted data.

## Demo scenarios (one click each)

| Preset | What happens |
|---|---|
| ⌨️ Keyboard (max $120, ask above $80) | Agent finds a $65 keyboard at a store with returns → **ALLOW** → paid via PayPal sandbox |
| 🎧 Headphones (ask above $80) | Agent picks $95 headphones → **REVIEW** → you approve → paid |
| 💡 Desk lamp (max $100) | The lamp's product page tells AI buyers to pay a $49 "refundable fulfilment deposit" to a third-party escrow payee. The agent takes the bait and tries. Leash **BLOCKS** it — the hard rules reject the unverified payee and price mismatch, and the AI judge independently flags prompt injection. No money leaves the wallet. |

## PayPal integration

- **OAuth 2.0 client credentials** against `api-m.sandbox.paypal.com`
- **Payouts API** (`POST /v1/payments/payouts`) — the agent's wallet (your sandbox business account) pays the merchant only after Leash approves
- **Payout status** (`GET /v1/payments/payouts/{id}`) — the agent can verify a payment landed
- Every audit row stores the real PayPal **payout batch id** so it can be traced in the sandbox dashboard

If PayPal credentials are missing, the app runs in clearly-labelled **simulated** payment mode so the AI flow can still be explored.

## AI tools used

| Tool | Used for |
|---|---|
| **OpenAI** (`gpt-5-mini` by default, configurable) — structured outputs | Compiling a plain-English mandate into a strict JSON spending policy |
| **OpenAI** — tool calling | The autonomous shopping agent (search, read pages, pay, check status) |
| **OpenAI** — structured outputs | The independent AI judge: intent match score, injection detection, verdict, plain-English reason |
| **AG Grid Community** (sponsor tool) | Sortable / filterable audit trail of every payment attempt |

## Run it locally

Requirements: Node.js 20+.

```bash
git clone <this repo>
cd <repo>
npm install
cp .env.example .env   # then fill in the values below
npm start              # http://localhost:3000
```

`.env`:

| Variable | Where to get it |
|---|---|
| `OPENAI_API_KEY` | platform.openai.com → API keys |
| `OPENAI_MODEL` | optional, defaults to `gpt-5-mini` |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | developer.paypal.com → Apps & Credentials → **Sandbox** → create app |
| `PAYPAL_MERCHANT_RECEIVER` | optional: a sandbox *personal* account email (Testing Tools → Sandbox Accounts) to receive payouts |

Then open the app, click a preset, **Compile spending policy**, review it, and **Launch agent**.

## Project structure

```
src/
  server.ts    Express API + Server-Sent Events stream
  policy.ts    mandate → policy compiler (OpenAI)
  agent.ts     shopping agent (OpenAI tool calling)
  firewall.ts  hard rules + AI judge + approval flow + PayPal execution
  paypal.ts    PayPal sandbox OAuth + Payouts client
  catalog.ts   demo storefronts (one page contains a prompt injection)
  store.ts     in-memory runs, approvals, audit log
public/        UI (vanilla JS + AG Grid)
```

## Limitations / next steps

- Storefronts are mocked so the injection demo is reproducible; payments are real PayPal sandbox payouts.
- Audit log is in-memory (resets on restart).
- Next: expose Leash as an MCP server so *any* agent (including PayPal's Agent Toolkit) can be wrapped, per-merchant reputation, and spending mandates shared across family members.

## License

MIT — see [LICENSE](LICENSE).
