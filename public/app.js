const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = (n) => `$${Number(n).toFixed(2)}`;

let policy = null;
let source = null;
let pendingApproval = null;

// ---------- status pills ----------
fetch("/api/health").then((r) => r.json()).then((h) => {
  $("pill-ai").textContent = h.ai ? `AI: ${h.ai}` : "AI: key missing";
  $("pill-ai").className = `pill ${h.ai ? "ok" : "warn"}`;
  $("pill-pp").textContent = h.paypal === "sandbox" ? "PayPal: sandbox live" : "PayPal: simulated";
  $("pill-pp").className = `pill ${h.paypal === "sandbox" ? "ok" : "warn"}`;
});

// ---------- step 1: mandate -> policy ----------
document.querySelectorAll("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    $("mandate").value = b.dataset.preset;
    $("policy").classList.add("hidden");
  }),
);

$("compile").addEventListener("click", async () => {
  const mandate = $("mandate").value.trim();
  if (!mandate) return $("mandate").focus();
  $("compile").disabled = true;
  $("compile").textContent = "Compiling…";
  try {
    const res = await fetch("/api/mandate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mandate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    policy = data.policy;
    renderPolicy(policy);
  } catch (e) {
    alert(`Could not compile policy: ${e.message}`);
  } finally {
    $("compile").disabled = false;
    $("compile").textContent = "Compile spending policy";
  }
});

function renderPolicy(p) {
  $("policy-summary").textContent = p.summary;
  const rows = [
    ["Goal", p.goal],
    ["Total budget", money(p.max_total)],
    ["Per purchase", money(p.max_per_purchase)],
    ["Ask me above", money(p.approval_threshold)],
    ["Categories", p.allowed_categories.join(", ") || "any"],
    ["Returns required", p.require_returns ? "yes" : "no"],
    ["Blocked merchants", p.blocked_merchants.join(", ") || "none"],
  ];
  $("policy-grid").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  $("policy").classList.remove("hidden");
}

// ---------- step 2: run agent + live feed ----------
$("launch").addEventListener("click", async () => {
  if (!policy) return;
  $("launch").disabled = true;
  $("feed").innerHTML = "";
  $("spent").classList.add("hidden");
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mandate: $("mandate").value, policy }),
  });
  const { runId, error } = await res.json();
  if (error) {
    $("launch").disabled = false;
    return alert(error);
  }
  source?.close();
  source = new EventSource(`/api/runs/${runId}/events`);
  source.onmessage = (m) => handleEvent(JSON.parse(m.data));
});

function addFeed(cls, tag, html) {
  const li = document.createElement("li");
  li.className = cls;
  li.innerHTML = `<span class="tag">${esc(tag)}</span>${html}`;
  $("feed").appendChild(li);
  li.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function describe(req) {
  return `${money(req.amount)} ${esc(req.currency)} → <b>${esc(req.payee)}</b>${req.payee_email ? ` (${esc(req.payee_email)})` : ""} for <code>${esc(req.product_id || "—")}</code>`;
}

function handleEvent(e) {
  switch (e.type) {
    case "agent_message":
      addFeed("", "Agent", esc(e.text));
      break;
    case "tool_call":
      if (e.tool === "pay") break; // shown via firewall events
      addFeed("", `Agent → ${e.tool}`, `<code>${esc(JSON.stringify(e.args))}</code>`);
      break;
    case "firewall_check":
      addFeed("", "Leash intercepted payment", `${describe(e.request)}<br><span class="muted">Agent's reason: ${esc(e.request.justification)}</span>`);
      break;
    case "firewall_decision": {
      const cls = e.decision.toLowerCase();
      const inj = e.judge?.injection_detected ? " · ⚠️ prompt injection detected" : "";
      addFeed(cls, `Decision (${e.layer})`, `<span class="verdict">${e.decision}</span>${inj}<br>${esc(e.reason)}`);
      break;
    }
    case "approval_required":
      pendingApproval = e.approvalId;
      $("approval-body").innerHTML = describe(e.request);
      $("approval-reason").textContent = e.reason;
      $("approval").classList.remove("hidden");
      $("approve").focus();
      break;
    case "approval_resolved":
      $("approval").classList.add("hidden");
      addFeed(e.approved ? "allow" : "block", "You", e.approved ? "Approved" : "Denied");
      break;
    case "payment_sent":
      addFeed("paid", "PayPal", `✅ Paid ${describe(e.request)}<br><span class="muted">Payout batch <code>${esc(e.payment.id)}</code> · ${esc(e.payment.status)}${e.payment.simulated ? " (simulated)" : ""}</span>`);
      $("spent").textContent = `Spent so far: ${money(e.spent)} of ${money(policy.max_total)}`;
      $("spent").classList.remove("hidden");
      break;
    case "payment_failed":
      addFeed("block", "PayPal error", esc(e.error));
      break;
    case "error":
      addFeed("block", "Error", esc(e.error));
      break;
    case "done":
      addFeed("", "Run finished", `Total spent: ${money(e.spent)}`);
      $("launch").disabled = false;
      source?.close();
      loadAudit();
      break;
  }
}

async function answerApproval(approved) {
  if (!pendingApproval) return;
  const id = pendingApproval;
  pendingApproval = null;
  await fetch(`/api/approvals/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved }),
  });
}
$("approve").addEventListener("click", () => answerApproval(true));
$("deny").addEventListener("click", () => answerApproval(false));

// ---------- step 3: audit trail (AG Grid) ----------
const decisionStyle = (p) => {
  const map = { ALLOW: "var(--allow)", APPROVED: "var(--allow)", BLOCK: "var(--block)", DENIED: "var(--block)", REVIEW: "var(--review)" };
  return { color: map[p.value] || "inherit", fontWeight: 700 };
};

const grid = agGrid.createGrid($("audit-grid"), {
  rowData: [],
  columnDefs: [
    { field: "time", headerName: "Time", width: 110, valueFormatter: (p) => new Date(p.value).toLocaleTimeString() },
    { field: "decision", width: 115, cellStyle: decisionStyle, filter: true },
    { field: "amount", width: 100, valueFormatter: (p) => money(p.value) },
    { field: "payee", width: 140, filter: true },
    { field: "productId", headerName: "Product", width: 100 },
    { field: "layer", headerName: "Decided by", width: 125, filter: true },
    { field: "injection", headerName: "Injection", width: 105, valueFormatter: (p) => (p.value ? "⚠️ yes" : "") },
    { field: "reason", flex: 1, minWidth: 260, tooltipField: "reason", wrapText: true, autoHeight: true },
    { field: "paypalId", headerName: "PayPal ID", width: 170 },
    { field: "paypalStatus", headerName: "PayPal status", width: 130 },
  ],
  defaultColDef: { sortable: true, resizable: true },
  overlayNoRowsTemplate: "No payment attempts yet.",
});

async function loadAudit() {
  const rows = await fetch("/api/audit").then((r) => r.json());
  grid.setGridOption("rowData", rows);
}
$("refresh-audit").addEventListener("click", loadAudit);
loadAudit();
