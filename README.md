# Leash — let your AI agent restock the business without handing it the keys to your PayPal

Small businesses are starting to let AI agents reorder supplies. But an agent that can spend money can also be **confused, over-eager, or hijacked** by text on a supplier's web page ("prompt injection"). Leash sits between the agent and PayPal: the owner writes the rules in plain English, and every payment the agent attempts is checked, explained, and either **allowed**, **blocked**, or **sent to the owner for approval in PayPal's own checkout** — with a full audit trail.

> Built for the PayPal AI Hackathon — *Build what's next with PayPal and AI*.

**Demo persona:** *Corner Café*. The owner lets an AI agent reorder coffee beans, cups and oat milk from approved wholesale suppliers.

## What's new here

- **Plain English → enforceable policy.** "Reorder espresso, max $150 this week, returns only, ask me above $100" is compiled by an LLM into a strict JSON policy the owner confirms before the agent starts.
- **Live prompt-injection defence.** A supplier page tries to hijack the agent into paying a fake "logistics deposit" to a third party. Leash blocks it in real time and explains why.
- **Intent-drift detection.** An independent AI judge checks each payment against what the owner actually asked for — not what the agent was told by a web page.
- **PayPal is the human-in-the-loop.** Escalated payments become real PayPal Orders that the owner approves in PayPal's buyer-approval popup; Leash captures only after PayPal confirms.

## How it works

```
 Owner (plain-English mandate)
        │
        ▼
 ① Policy compiler (LLM, structured output) ──► enforceable spending policy (owner confirms)
        │
        ▼
 ② Restocking agent (LLM tool calling) ── search / read supplier pages / pay()
        │                                              │
        │                         every pay() is intercepted
        ▼                                              ▼
 ③ Leash firewall ─┬─ Layer 1: hard rules (budget, verified payee, exact price, returns, category)
                   └─ Layer 2: AI judge (intent match + prompt-injection detection)
        │
   ALLOW ──► PayPal Payouts API (sandbox) ─► payout batch id + status
   REVIEW ─► PayPal Orders API: order created ─► owner approves in PayPal popup (JS SDK) ─► Leash captures
   BLOCK ──► nothing is sent; the agent is told why
        │
        ▼
 ④ Audit trail (AG Grid): every attempt, decision, deciding layer, reason, PayPal id + status
```

### Security model: the AI never approves money on its own

Prompt injection can't be reliably stopped by a model alone, so Leash doesn't rely on one.

1. **Hard rules make the real decision.** Deterministic code checks the payee is a verified supplier, the amount equals the listed price, and budget, category and returns rules hold. They can't be talked out of a limit.
2. **The AI judge can only make a decision stricter.** It can never approve something the rules reject. It may block outright only when it detects prompt injection; otherwise it can only escalate to the owner.
3. **The judge sees evidence, not instructions.** It gets the owner's mandate and the page content the agent read (treated as untrusted data) — never the agent's own system prompt — and numeric limits are withheld from it because they're the rules engine's job.
4. **Owner approval happens in PayPal**, not in a button the agent could fake.

## Demo scenarios (one click each)

| Preset | What happens |
|---|---|
| ☕ Espresso beans (max $150, ask above $100) | Agent picks the $64 house espresso from a supplier with returns (and skips a cheaper no-returns clearance bag) → **ALLOW** → paid via PayPal Payouts |
| 🥤 Cups (budget $200, ask above $100) | Agent picks a $128 case of compostable cups → **REVIEW** → PayPal Order created → owner approves in PayPal → captured |
| 🥛 Oat milk (max $100) | The supplier page tells "AI purchasing agents" to pay a $49 "refundable cold-chain deposit" to FastShip Escrow. The agent takes the bait. The real $36 oat milk is **ALLOWED**; the $49 deposit is **BLOCKED** — hard rules reject the unverified payee and price mismatch, and the AI judge independently flags prompt injection. |

## PayPal integration

| PayPal capability | How Leash uses it |
|---|---|
| **OAuth 2.0** client credentials (`/v1/oauth2/token`) | Server-side auth against `api-m.sandbox.paypal.com`, token cached |
| **Payouts API** (`POST /v1/payments/payouts`) | Autonomous payments the firewall has allowed: the business wallet pays the supplier |
| **Payouts status** (`GET /v1/payments/payouts/{id}`) | The agent can verify a payment landed |
| **Orders API v2** (`POST /v2/checkout/orders`, `/capture`) | Escalated payments become real orders; captured only after the owner approves |
| **JavaScript SDK** (PayPal Buttons) | The owner's approval step is PayPal's own buyer-approval popup |

Every audit row stores the PayPal payout batch id or order id so it can be traced in the sandbox dashboard. Without PayPal credentials the app runs in clearly-labelled **simulated** payment mode so the AI flow can still be explored.

## AI tools used

| Tool | Used for |
|---|---|
| **Groq** — `openai/gpt-oss-120b` (default), via the OpenAI-compatible API | All three AI roles below |
| **OpenAI** (alternative, `AI_PROVIDER=openai`) | Same roles; switch in `.env` |
| LLM structured outputs | **Policy compiler**: plain-English mandate → strict JSON spending policy |
| LLM tool calling | **Restocking agent**: search catalog, read supplier pages, pay, check payout status |
| LLM structured outputs | **AI judge**: intent-match score, prompt-injection flag, verdict, plain-English reason |
| **AG Grid Community** (sponsor tool) | Sortable, filterable audit trail of every payment attempt |

## Run it locally

Requirements: Node.js 20+.

```bash
git clone https://github.com/arsh-aryan/PayPal-Hack.git
cd PayPal-Hack
npm install
cp .env.example .env   # then fill in the values below
npm start              # http://localhost:3000
```

| Variable | Where to get it |
|---|---|
| `AI_PROVIDER` | `groq` (default if only a Groq key is set) or `openai` |
| `GROQ_API_KEY` | console.groq.com → API Keys (free tier works) |
| `OPENAI_API_KEY` | platform.openai.com → API keys (only if using OpenAI) |
| `AI_MODEL` | optional override; defaults to `openai/gpt-oss-120b` (Groq) or `gpt-5-mini` (OpenAI) |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | developer.paypal.com → Apps & Credentials → **Sandbox** → Create App |
| `PAYPAL_MERCHANT_RECEIVER` | optional: a sandbox *personal* account email (Testing Tools → Sandbox Accounts) that receives payouts |

Then: click a preset → **Compile spending policy** → review it → **Launch agent**. For the cups scenario, approve in the PayPal popup by signing in with your **sandbox personal (buyer) account**.

## Project structure

```
src/
  server.ts    Express API + Server-Sent Events stream
  policy.ts    mandate → policy compiler (LLM)
  agent.ts     restocking agent (LLM tool calling)
  firewall.ts  hard rules + AI judge + approval flow + PayPal execution
  paypal.ts    PayPal sandbox OAuth, Payouts and Orders client
  llm.ts       provider switch (Groq / OpenAI)
  catalog.ts   demo supplier storefronts (one page contains a prompt injection)
  store.ts     in-memory runs, approvals, audit log
public/        UI (vanilla JS + AG Grid + PayPal JS SDK)
```

## Limitations / next steps

- Supplier storefronts are mocked so the injection demo is reproducible; payments are real PayPal sandbox calls.
- The audit log is in-memory and resets on restart.
- Next: expose Leash as an MCP server so any agent (including ones built on PayPal's Agent Toolkit) can be wrapped; per-supplier reputation; recurring weekly restock mandates.

## License

MIT — see [LICENSE](LICENSE).
