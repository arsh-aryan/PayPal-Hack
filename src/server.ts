import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "./agent.js";
import { merchants, products } from "./catalog.js";
import { paypalConfigured } from "./paypal.js";
import { aiConfigured, model, providerName } from "./llm.js";
import { compileMandate, type Policy } from "./policy.js";
import { audit, createRun, resolveApproval, runs } from "./store.js";

const app = express();
app.use(express.json());
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ai: aiConfigured() ? `${providerName()} · ${model()}` : null,
    paypal: paypalConfigured() ? "sandbox" : "simulated",
  });
});

app.get("/api/catalog", (_req, res) => res.json({ merchants, products }));

// Step 1: plain-English mandate -> enforceable policy
app.post("/api/mandate", async (req, res) => {
  try {
    const mandate = String(req.body?.mandate ?? "").trim();
    if (!mandate) return res.status(400).json({ error: "mandate is required" });
    res.json({ policy: await compileMandate(mandate) });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Step 2: start the agent with a confirmed policy
app.post("/api/runs", (req, res) => {
  const mandate = String(req.body?.mandate ?? "");
  const policy = req.body?.policy as Policy | undefined;
  if (!mandate || !policy) return res.status(400).json({ error: "mandate and policy are required" });
  const run = createRun();
  void runAgent(run, mandate, policy);
  res.json({ runId: run.id });
});

// Live event stream for a run (Server-Sent Events)
app.get("/api/runs/:id/events", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  run.history.forEach(send);
  run.events.on("event", send);
  req.on("close", () => run.events.off("event", send));
});

app.post("/api/approvals/:id", (req, res) => {
  const ok = resolveApproval(req.params.id, Boolean(req.body?.approved));
  res.status(ok ? 200 : 404).json({ ok });
});

app.get("/api/audit", (_req, res) => res.json(audit));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Guardrail running on http://localhost:${port}`);
  console.log(`  AI: ${aiConfigured() ? `${providerName()} (${model()})` : "MISSING KEY"}`);
  console.log(`  PayPal: ${paypalConfigured() ? "sandbox" : "simulated (no credentials)"}`);
});
