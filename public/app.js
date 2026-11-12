const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = (n) => `$${Number(n).toFixed(2)}`;
const shortMoney = (n) => (Number(n) % 1 ? money(n) : `$${Number(n)}`);
const clock = (iso) => new Date(iso || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const mdLite = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

let policy = null;
let source = null;
let pendingApproval = null;
let stats = { attempts: 0, paid: 0, review: 0, blocked: 0, spent: 0 };

const ICONS = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/></svg>',
  page: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 19 6v5.5c0 4.4-3 7.8-7 9.5-4-1.7-7-5.1-7-9.5V6z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10"/></svg>',
  cross: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/></svg>',
  bot: '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4h11l-2 4 2 4H5"/></svg>',
};

// ---------------- status + PayPal SDK ----------------
fetch("/api/health").then((r) => r.json()).then((h) => {
  setChip("pill-ai", h.ai ? h.ai.replace(" · ", " / ") : "AI key missing", Boolean(h.ai));
  setChip("pill-pp", h.paypal === "sandbox" ? "PayPal sandbox" : "PayPal simulated", h.paypal === "sandbox");
  $("paypal-sub").textContent = h.paypal === "sandbox" ? "sandbox" : "simulated";
  if (h.paypalClientId) {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(h.paypalClientId)}&currency=USD&intent=capture`;
    document.head.appendChild(s);
  }
});
function setChip(id, text, ok) {
  $(id).className = `chip ${ok ? "ok" : "warn"}`;
  $(id).querySelector("span").textContent = text;
}

window.addEventListener("load", () => window.LeashAnim?.mountGate($("lottie-gate")));

// ---------------- step 1: mandate -> policy ----------------
document.querySelectorAll(".scenario").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".scenario").forEach((x) => x.classList.toggle("selected", x === b));
    $("mandate").value = b.dataset.preset;
    $("mandate").focus();
  }),
);

function setStep(n) {
  [1, 2, 3].forEach((i) => {
    $(`st-${i}`).classList.toggle("active", i === n);
    $(`st-${i}`).classList.toggle("done", i < n);
  });
}

function busy(btn, on, label) {
  btn.disabled = on;
  btn.classList.toggle("loading", on);
  if (label) btn.querySelector(".btn-label").textContent = label;
}

$("compile").addEventListener("click", async () => {
  const mandate = $("mandate").value.trim();
  if (!mandate) return $("mandate").focus();
  busy($("compile"), true, "Compiling");
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
    busy($("compile"), false, "Compile policy");
  }
});

function renderPolicy(p) {
  $("policy-summary").textContent = p.summary;
  const rows = [
    ["Total budget", shortMoney(p.max_total)],
    ["Max per payment", shortMoney(p.max_per_purchase)],
    ["Ask me above", shortMoney(p.approval_threshold)],
    ["Categories", p.allowed_categories.join(", ") || "any"],
    ["Returns required", p.require_returns ? "yes" : "no"],
    ["Blocked suppliers", p.blocked_merchants.join(", ") || "none"],
  ];
  $("policy-grid").innerHTML = rows
    .map(([k, v], i) => `<dt style="animation-delay:${i * 40}ms">${esc(k)}</dt><dd style="animation-delay:${i * 40}ms">${esc(v)}</dd>`)
    .join("");
  $("compose").hidden = true;
  $("policy").hidden = false;
  setStep(2);
  renderBudget();
}

$("edit").addEventListener("click", () => {
  $("policy").hidden = true;
  $("compose").hidden = false;
  setStep(1);
});

// ---------------- step 2: run ----------------
$("launch").addEventListener("click", async () => {
  if (!policy) return;
  busy($("launch"), true, "Running");
  $("edit").disabled = true;
  resetRun();
  setStep(3);
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mandate: $("mandate").value, policy }),
  });
  const { runId, error } = await res.json();
  if (error) {
    busy($("launch"), false, "Launch agent");
    $("edit").disabled = false;
    return alert(error);
  }
  $("live").hidden = false;
  setFlow("busy", "Agent working");
  source?.close();
  source = new EventSource(`/api/runs/${runId}/events`);
  source.onmessage = (m) => handleEvent(JSON.parse(m.data));
});

function resetRun() {
  stats = { attempts: 0, paid: 0, review: 0, blocked: 0, spent: 0 };
  $("feed").innerHTML = "";
  ["c-attempts", "c-allowed", "c-review", "c-blocked"].forEach((id) => ($(id).textContent = "0"));
  setVerdict("none", "Waiting for a payment", "", "The agent is shopping. Any payment it attempts stops here first.");
  renderBudget();
}

// ---------------- pipeline visuals ----------------
function setFlow(state, label, tone) {
  $("flow").dataset.state = state;
  const pill = $("pipe-state");
  pill.textContent = label;
  pill.className = `pipe-state ${tone || (state === "busy" || state === "check" ? "busy" : state)}`;
  window.LeashAnim?.gate(state);
  $("wire-1").classList.toggle("flowing", state === "busy");
}
function fire(wireId, cls) {
  const w = $(wireId);
  w.classList.remove("send", "burst");
  void w.offsetWidth; // restart CSS animation
  w.classList.add(cls);
}
function setLayer(id, cls, label) {
  $(id).className = `layer ${cls}`;
  if (label) $(id).textContent = label;
}
function setVerdict(kind, word, amount, reason) {
  const v = $("verdict");
  v.dataset.kind = kind;
  $("verdict-word").textContent = word;
  $("verdict-amt").textContent = amount;
  $("verdict-reason").textContent = reason;
  v.classList.remove("pop");
  void v.offsetWidth;
  if (kind !== "none") {
    v.classList.add("pop");
    window.LeashAnim?.verdict($("lottie-verdict"), kind);
  }
}

// ---------------- session stats ----------------
function bump(id, value) {
  const el = $(id);
  el.textContent = String(value);
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}
function countUp(el, to) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 700);
    const val = from + (to - from) * (1 - Math.pow(1 - k, 3));
    el.textContent = shortMoney(Math.round(val * 100) / 100);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function renderBudget() {
  if (!policy) return;
  countUp($("spent-num"), stats.spent);
  $("spent-of").textContent = `of ${shortMoney(policy.max_total)} budget`;
  $("meter-fill").style.width = `${Math.min(100, (stats.spent / policy.max_total) * 100)}%`;
  const tick = $("meter-tick");
  tick.hidden = !(policy.approval_threshold < policy.max_total);
  tick.style.left = `${(policy.approval_threshold / policy.max_total) * 100}%`;
  $("meter-legend").textContent = `Amber line: payments above ${shortMoney(policy.approval_threshold)} need your approval`;
}

// ---------------- timeline ----------------
function addEvent({ kind = "", icon = "bot", title, detail = "", at }) {
  const empty = $("feed").querySelector(".empty");
  if (empty) empty.remove();
  const li = document.createElement("li");
  li.className = `ev ${kind}`;
  li.innerHTML = `
    <span class="ev-icon">${ICONS[icon] || ICONS.bot}</span>
    <div><div class="ev-title">${title}</div>${detail ? `<div class="ev-detail">${detail}</div>` : ""}</div>
    <span class="ev-time">${clock(at)}</span>`;
  $("feed").appendChild(li);
  $("feed").scrollTop = $("feed").scrollHeight;
}

const payeeLine = (r) =>
  `<b>${shortMoney(r.amount)}</b> to <b>${esc(r.payee)}</b>${r.product_id ? ` for <code>${esc(r.product_id)}</code>` : ""}`;

function handleEvent(e) {
  switch (e.type) {
    case "tool_call":
      if (e.tool === "search_products") {
        $("agent-sub").textContent = "searching";
        addEvent({ icon: "search", title: `Searched suppliers for “${esc(e.args.query)}”`, at: e.at });
      } else if (e.tool === "view_product") {
        $("agent-sub").textContent = "reading page";
        addEvent({ icon: "page", title: `Read supplier page <code>${esc(e.args.product_id)}</code>`, at: e.at });
      } else if (e.tool === "check_payment_status") {
        addEvent({ icon: "card", title: "Checked payout status", detail: `<code>${esc(e.args.payout_batch_id)}</code>`, at: e.at });
      }
      break;

    case "firewall_check":
      stats.attempts++;
      bump("c-attempts", stats.attempts);
      $("agent-sub").textContent = `paying ${shortMoney(e.request.amount)}`;
      setLayer("layer-rules", "scan");
      setLayer("layer-ai", "scan");
      fire("wire-1", "send");
      setFlow("check", "Inspecting payment");
      setVerdict("none", "Inspecting…", shortMoney(e.request.amount), `${e.request.payee} · agent says: “${e.request.justification}”`);
      addEvent({ kind: "gate", icon: "shield", title: `Payment intercepted · ${payeeLine(e.request)}`, detail: `Agent’s reason: “${esc(e.request.justification)}”`, at: e.at });
      break;

    case "firewall_decision": {
      const d = e.decision;
      const kind = d === "ALLOW" ? "allow" : d === "REVIEW" ? "review" : "block";
      const rv = e.rules?.verdict;
      setLayer("layer-rules", rv === "ALLOW" ? "pass" : rv === "REVIEW" ? "warn" : "fail");
      const jv = e.judge?.verdict;
      setLayer("layer-ai", e.judge?.injection_detected && d === "BLOCK" ? "fail" : jv === "allow" ? "pass" : jv === "review" ? "warn" : "fail",
        e.judge?.injection_detected ? "AI · injection" : "AI judge");

      const words = { allow: "Allowed", review: "Needs approval", block: "Blocked" };
      setVerdict(kind, words[kind], shortMoney(e.request.amount), e.reason);
      if (kind === "allow") { fire("wire-2", "send"); setFlow("allow", "Allowed"); }
      if (kind === "review") { stats.review++; bump("c-review", stats.review); setFlow("review", "Waiting for you"); }
      if (kind === "block") { stats.blocked++; bump("c-blocked", stats.blocked); fire("wire-1", "burst"); setFlow("block", "Blocked"); }

      const inj = e.judge?.injection_detected
        ? d === "BLOCK"
          ? ` <span class="flag">· prompt injection detected</span>`
          : ` <span class="muted">· injection seen on page, this payment is unaffected</span>`
        : "";
      addEvent({
        kind,
        icon: kind === "allow" ? "check" : kind === "review" ? "alert" : "cross",
        title: `<span class="tagline-inline">${d}</span>${payeeLine(e.request)}${inj}`,
        detail: `${esc(e.reason)} <span class="muted">· decided by ${esc(e.layer)}</span>`,
        at: e.at,
      });
      break;
    }

    case "paypal_order_created":
      $("paypal-sub").textContent = `order ${e.orderId}`;
      addEvent({ kind: "review", icon: "card", title: `PayPal order created <code>${esc(e.orderId)}</code>`, detail: "Waiting for the owner to approve in PayPal", at: e.at });
      break;

    case "approval_required":
      openApproval(e);
      break;

    case "approval_resolved":
      closeApproval();
      addEvent({ kind: e.approved ? "allow" : "block", icon: "user", title: e.approved ? "Owner approved the payment" : "Owner denied the payment", at: e.at });
      if (e.approved) fire("wire-2", "send");
      setFlow(e.approved ? "allow" : "block", e.approved ? "Approved" : "Denied");
      break;

    case "payment_sent": {
      stats.paid++;
      stats.spent = e.spent;
      bump("c-allowed", stats.paid);
      renderBudget();
      const isOrder = e.payment.kind === "order";
      $("paypal-sub").textContent = e.payment.simulated ? "simulated" : isOrder ? "order captured" : "payout sent";
      const ref = isOrder
        ? `Order <code>${esc(e.payment.id)}</code> captured${e.payment.captureId ? ` · capture <code>${esc(e.payment.captureId)}</code>` : ""}`
        : `Payout batch <code>${esc(e.payment.id)}</code>`;
      addEvent({
        kind: "paid", icon: "card",
        title: `Paid via PayPal · ${payeeLine(e.request)}`,
        detail: `${ref} · ${esc(e.payment.status)}${e.payment.simulated ? " (simulated)" : ""}`,
        at: e.at,
      });
      break;
    }

    case "payment_failed":
      addEvent({ kind: "block", icon: "cross", title: "PayPal error", detail: esc(e.error), at: e.at });
      break;

    case "agent_message":
      addEvent({ kind: "agent", icon: "bot", title: mdLite(e.text), at: e.at });
      break;

    case "error":
      addEvent({ kind: "block", icon: "cross", title: "Run error", detail: esc(e.error), at: e.at });
      break;

    case "done":
      addEvent({ icon: "flag", title: `Run finished · spent ${shortMoney(e.spent)}`, at: e.at });
      $("live").hidden = true;
      $("agent-sub").textContent = "done";
      busy($("launch"), false, "Run again");
      $("edit").disabled = false;
      if ($("flow").dataset.state === "busy" || $("flow").dataset.state === "check") setFlow("idle", "Run finished", "");
      source?.close();
      loadAudit();
      break;
  }
}

// ---------------- approval sheet ----------------
function renderPayPalApproval(orderId) {
  const box = $("paypal-buttons");
  box.innerHTML = "";
  if (!orderId || !window.paypal) return false;
  window.paypal
    .Buttons({
      style: { layout: "vertical", label: "pay", shape: "rect", height: 44 },
      createOrder: () => orderId, // created server-side by Leash
      onApprove: () => answerApproval(true), // Leash captures server-side
      onError: (err) => addEvent({ kind: "block", icon: "cross", title: "PayPal error", detail: esc(err?.message || err) }),
    })
    .render(box);
  return true;
}

function openApproval(e) {
  pendingApproval = e.approvalId;
  $("approval-amount").textContent = shortMoney(e.request.amount);
  $("approval-body").innerHTML = `${payeeLine(e.request)}<br><span class="muted">${esc(e.request.justification)}</span>`;
  $("approval-reason").textContent = e.reason;
  $("approval-order").textContent = e.orderId ? `PayPal order ${e.orderId}` : "";
  const viaPayPal = renderPayPalApproval(e.orderId);
  $("approve").hidden = viaPayPal;
  $("paypal-hint").hidden = !viaPayPal;
  $("approval").hidden = false;
  (viaPayPal ? $("deny") : $("approve")).focus();
}
function closeApproval() {
  $("approval").hidden = true;
  $("paypal-buttons").innerHTML = "";
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
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !$("approval").hidden) answerApproval(false);
});

// ---------------- audit ledger (AG Grid) ----------------
const pill = (p) => (p.value ? `<span class="pillcell ${esc(p.value)}">${esc(p.value)}</span>` : "");

const grid = agGrid.createGrid($("audit-grid"), {
  rowData: [],
  columnDefs: [
    { field: "time", headerName: "Time", width: 105, cellClass: "cell-mono", valueFormatter: (p) => clock(p.value) },
    { field: "decision", width: 120, cellRenderer: pill, filter: true },
    { field: "amount", width: 95, cellClass: "cell-mono", type: "rightAligned", valueFormatter: (p) => money(p.value) },
    { field: "payee", width: 145, filter: true },
    { field: "productId", headerName: "Item", width: 95, cellClass: "cell-mono" },
    { field: "layer", headerName: "Decided by", width: 130, filter: true },
    { field: "injection", headerName: "Injection", width: 105, cellRenderer: (p) => (p.value ? '<span class="flag">detected</span>' : "") },
    { field: "reason", flex: 1, minWidth: 280, tooltipField: "reason", wrapText: true, autoHeight: true },
    { field: "paypalId", headerName: "PayPal ref", width: 190, cellClass: "cell-mono" },
    { field: "paypalStatus", headerName: "Status", width: 150, cellClass: "cell-mono" },
  ],
  defaultColDef: { sortable: true, resizable: true },
  animateRows: true,
  overlayNoRowsTemplate: '<span class="muted">No payment attempts yet. Every attempt the agent makes is recorded here.</span>',
});

async function loadAudit() {
  const rows = await fetch("/api/audit").then((r) => r.json());
  grid.setGridOption("rowData", rows);
}
$("refresh-audit").addEventListener("click", loadAudit);
loadAudit();
