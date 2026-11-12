const $ = (id) => document.getElementById(id);

// No accounts in the demo: an anonymous id per browser keeps each visitor's ledger separate.
const VISITOR = (() => {
  try {
    let v = localStorage.getItem("leash-visitor");
    if (!v) { v = crypto.randomUUID(); localStorage.setItem("leash-visitor", v); }
    return v;
  } catch { return crypto.randomUUID(); }
})();
const VH = { "x-visitor-id": VISITOR };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clock = (iso) => new Date(iso || Date.now()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const mdLite = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

// ---------------- top progress bar (counts concurrent tasks) ----------------
const Progress = (() => {
  let jobs = 0, timer;
  const bar = () => document.getElementById("topbar");
  return {
    start() {
      jobs++;
      const b = bar(); if (!b) return;
      clearTimeout(timer);
      b.classList.remove("finish");
      b.firstElementChild.style.width = "";
      void b.offsetWidth;
      b.classList.add("active");
    },
    done() {
      jobs = Math.max(0, jobs - 1);
      if (jobs) return;
      const b = bar(); if (!b) return;
      b.classList.remove("active");
      b.classList.add("finish");
      timer = setTimeout(() => b.classList.remove("finish"), 450);
    },
  };
})();
Progress.start(); // page load

let policy = null;
let source = null;
let pendingApproval = null;
let stats = { attempts: 0, paid: 0, review: 0, blocked: 0, spent: 0 };
let lastAgentText = "";
const pagesRead = {}; // product id -> supplier page text the agent read

// Glyphs so verdicts never depend on colour alone
const GLYPH = {
  allow: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 5 9.2 10 3"/></svg>',
  review: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v5M6 10h.01"/></svg>',
  block: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>',
};
const LABEL = { allow: "Allow", review: "Review", block: "Block" };
const tag = (kind, text) => `<span class="verdict-tag mono" data-v="${kind}">${GLYPH[kind]}${esc(text || LABEL[kind])}</span>`;

// ---------------- status + PayPal SDK ----------------
fetch("/api/health").then((r) => r.json()).then((h) => {
  setChip("pill-ai", h.ai ? h.ai.replace(" · ", " / ") : "AI key missing", Boolean(h.ai));
  setChip("pill-pp", h.paypal === "sandbox" ? "PayPal sandbox" : "PayPal simulated", h.paypal === "sandbox");
  $("paypal-sub").textContent = h.paypal === "sandbox" ? "sandbox" : "simulated";
  if (h.paypalClientId) {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(h.paypalClientId)}&currency=USD&intent=capture&disable-funding=card,credit,paylater`;
    document.head.appendChild(s);
  }
});
function setChip(id, text, ok) {
  $(id).className = `chip ${ok ? "ok" : "warn"}`;
  $(id).querySelector("span").textContent = text;
}
window.addEventListener("load", () => window.LeashAnim?.mountGate($("lottie-gate")));

// ---------------- steps + buttons ----------------
function setStep(n) {
  [1, 2, 3, 4].forEach((i) => {
    $(`st-${i}`).classList.toggle("active", i === n);
    $(`st-${i}`).classList.toggle("done", i < n);
  });
}
function busy(btn, on, label) {
  btn.disabled = on;
  btn.setAttribute("aria-busy", on ? "true" : "false");
  if (label) btn.querySelector(".btn-label").textContent = label;
}

// ---------------- 1. mandate ----------------
document.querySelectorAll(".scenario").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".scenario").forEach((x) => x.classList.toggle("selected", x === b));
    $("mandate").value = b.dataset.preset;
  }),
);

$("compile").addEventListener("click", async () => {
  const mandate = $("mandate").value.trim();
  if (!mandate) return $("mandate").focus();
  busy($("compile"), true, "Compiling policy…");
  Progress.start();
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
    alert(`Could not compile the policy: ${e.message}`);
  } finally {
    busy($("compile"), false, "Compile spending policy");
    Progress.done();
  }
});

// ---------------- 2. policy ----------------
function renderPolicy(p) {
  $("policy-summary").textContent = p.summary;
  const rows = [
    ["Total budget", money(p.max_total)],
    ["Max per payment", money(p.max_per_purchase)],
    ["Ask me above", money(p.approval_threshold)],
    ["Categories", p.allowed_categories.join(", ") || "any"],
    ["Returns required", p.require_returns ? "yes" : "no"],
    ["Blocked suppliers", p.blocked_merchants.join(", ") || "none"],
  ];
  $("policy-grid").innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
  $("compose").hidden = true;
  $("policy").hidden = false;
  setStep(2);
  renderBook();
}
$("edit").addEventListener("click", () => {
  $("policy").hidden = true;
  $("compose").hidden = false;
  setStep(1);
});

// ---------------- 3. run ----------------
$("launch").addEventListener("click", async () => {
  if (!policy) return;
  busy($("launch"), true, "Agent running…");
  Progress.start();
  $("edit").disabled = true;
  resetRun();
  setStep(3);
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...VH },
    body: JSON.stringify({ mandate: $("mandate").value, policy }),
  });
  const { runId, error } = await res.json();
  if (error) {
    busy($("launch"), false, "Launch agent");
    $("edit").disabled = false;
    Progress.done();
    return alert(error);
  }
  $("live").hidden = false;
  if (matchMedia("(max-width: 880px)").matches) document.querySelector(".gate-block").scrollIntoView({ behavior: "smooth", block: "start" });
  setFlow("busy", "Agent working");
  source?.close();
  source = new EventSource(`/api/runs/${runId}/events`);
  source.onmessage = (m) => handleEvent(JSON.parse(m.data));
});

function resetRun() {
  stats = { attempts: 0, paid: 0, review: 0, blocked: 0, spent: 0 };
  lastAgentText = "";
  $("feed").innerHTML = "";
  ["c-attempts", "c-allowed", "c-review", "c-blocked"].forEach((id) => ($(id).textContent = "0"));
  setLayer("layer-rules", "", "Rules");
  setLayer("layer-ai", "", "AI judge");
  setVerdict("none", "Waiting for a payment", "", "The agent is shopping. Any payment it attempts stops here first.");
  renderBook();
}

// ---------------- gate visuals ----------------
function setFlow(state, label) {
  $("flow").dataset.state = state;
  const tone = state === "busy" || state === "check" ? "busy" : state === "idle" ? "" : state;
  $("pipe-state").textContent = label;
  $("pipe-state").className = `state mono ${tone}`;
  window.LeashAnim?.gate(state);
  $("wire-1").classList.toggle("flowing", state === "busy");
}
function fire(wireId, cls) {
  const w = $(wireId);
  w.classList.remove("send", "burst");
  void w.offsetWidth;
  w.classList.add(cls);
}
function setLayer(id, cls, label) {
  $(id).className = `layer ${cls}`;
  if (label) $(id).textContent = label;
}
function setVerdict(kind, word, amount, reason) {
  const v = $("verdict");
  v.dataset.kind = kind;
  $("verdict-word").innerHTML = kind === "none" ? esc(word) : `${esc(word)}`;
  $("verdict-amt").textContent = amount;
  $("verdict-reason").textContent = reason;
  v.classList.remove("pop");
  void v.offsetWidth;
  if (kind !== "none") {
    v.classList.add("pop");
    window.LeashAnim?.verdict($("lottie-verdict"), kind);
  }
}

// ---------------- this run (ledger book) ----------------
function tickNum(id, value) {
  const el = $(id);
  el.textContent = String(value);
  el.classList.remove("tick");
  void el.offsetWidth;
  el.classList.add("tick");
}
function countUp(el, to) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 600);
    el.textContent = money(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function renderBook() {
  if (!policy) return;
  $("spent-budget").textContent = money(policy.max_total);
  countUp($("spent"), stats.spent);
  $("spent-remaining").textContent = money(Math.max(0, policy.max_total - stats.spent));
  $("meter-fill").style.width = `${Math.min(100, (stats.spent / policy.max_total) * 100)}%`;
  const showTick = policy.approval_threshold < policy.max_total;
  $("meter-tick").hidden = !showTick;
  $("meter-tick").style.left = `${(policy.approval_threshold / policy.max_total) * 100}%`;
  $("meter-legend").textContent = showTick
    ? `Dashed line: single payments above ${money(policy.approval_threshold)} need your approval.`
    : `Every payment up to ${money(policy.max_per_purchase)} is checked against the rules.`;
}

// ---------------- activity log ----------------
function addEvent({ kind = "", label, glyph, text, detail = "", amount = "", at }) {
  const empty = $("feed").querySelector(".empty");
  if (empty) empty.remove();
  const li = document.createElement("li");
  li.className = `ev ${kind}`;
  li.innerHTML = `
    <span class="ev-time">${clock(at)}</span>
    <span class="ev-kind">${glyph ? GLYPH[glyph] : ""}${esc(label)}</span>
    <span class="ev-text">${text}${detail ? `<span class="ev-detail">${detail}</span>` : ""}</span>
    <span class="ev-amt">${amount ? money(amount) : ""}</span>`;
  $("feed").appendChild(li);
  $("feed").scrollTop = $("feed").scrollHeight;
}
// On a blocked injection, quote the supplier page and mark the sentences that caused it.
function showEvidence(req, at) {
  const text = pagesRead[req.product_id];
  if (!text) return;
  const needles = [String(req.payee).toLowerCase(), Number(req.amount).toFixed(2), String(req.payee_email || "\u0000").toLowerCase()];
  const html = text.split(/(?<=[.!?])\s+/).map((sentence) => {
    const low = sentence.toLowerCase();
    return needles.some((n) => n && low.includes(n)) ? `<mark>${esc(sentence)}</mark>` : esc(sentence);
  }).join(" ");
  if (!html.includes("<mark>")) return;
  addEvent({ kind: "evidence", glyph: "block", label: "Evidence", text: `What supplier page <code>${esc(req.product_id)}</code> told the agent`, detail: `<span class="quote">${html}</span>`, at });
}
const payee = (r) => `<b class="mono">${esc(r.payee)}</b>${r.product_id ? ` · <code>${esc(r.product_id)}</code>` : ""}`;

function handleEvent(e) {
  switch (e.type) {
    case "tool_call":
      if (e.tool === "search_products") {
        $("agent-sub").textContent = "searching";
        addEvent({ label: "Search", text: `Searched suppliers for “${esc(e.args.query)}”`, at: e.at });
      } else if (e.tool === "view_product") {
        $("agent-sub").textContent = "reading page";
        addEvent({ label: "Read", text: `Opened supplier page <code>${esc(e.args.product_id)}</code>`, at: e.at });
      } else if (e.tool === "check_payment_status") {
        addEvent({ label: "Status", text: `Checked payout <code>${esc(e.args.payout_batch_id)}</code>`, at: e.at });
      }
      break;

    case "firewall_check":
      stats.attempts++;
      tickNum("c-attempts", stats.attempts);
      $("agent-sub").textContent = `paying ${money(e.request.amount)}`;
      setLayer("layer-rules", "scan");
      setLayer("layer-ai", "scan");
      fire("wire-1", "send");
      setFlow("check", "Inspecting");
      setVerdict("none", "Inspecting payment…", money(e.request.amount), `To ${e.request.payee}. Agent's reason: “${e.request.justification}”`);
      addEvent({ label: "Attempt", text: `Payment to ${payee(e.request)}`, detail: `Agent's reason: “${esc(e.request.justification)}”`, amount: e.request.amount, at: e.at });
      break;

    case "firewall_decision": {
      const d = e.decision;
      const kind = d === "ALLOW" ? "allow" : d === "REVIEW" ? "review" : "block";
      const rv = e.rules?.verdict;
      setLayer("layer-rules", rv === "ALLOW" ? "pass" : rv === "REVIEW" ? "warn" : "fail");
      const injected = e.judge?.injection_detected;
      const jv = e.judge?.verdict;
      setLayer("layer-ai", injected && d === "BLOCK" ? "fail" : jv === "allow" ? "pass" : jv === "review" ? "warn" : "fail", injected ? "AI: injection" : "AI judge");

      setVerdict(kind, LABEL[kind], money(e.request.amount), e.reason);
      if (kind === "allow") { fire("wire-2", "send"); setFlow("allow", "Allowed"); }
      if (kind === "review") { stats.review++; tickNum("c-review", stats.review); setFlow("review", "Waiting for you"); }
      if (kind === "block") { stats.blocked++; tickNum("c-blocked", stats.blocked); fire("wire-1", "burst"); setFlow("block", "Blocked"); }

      const inj = injected
        ? d === "BLOCK"
          ? ` <span class="flag">Prompt injection</span>`
          : ` <span class="ev-detail">Injection found on the page. This payment itself is legitimate.</span>`
        : "";
      addEvent({
        kind, glyph: kind, label: LABEL[kind],
        text: `${payee(e.request)}${inj}`,
        detail: `${esc(e.reason)} — decided by ${esc(e.layer)}`,
        amount: e.request.amount, at: e.at,
      });
      if (kind === "block" && injected) showEvidence(e.request, e.at);
      break;
    }

    case "paypal_order_created":
      $("paypal-sub").textContent = `order ${e.orderId}`;
      addEvent({ label: "PayPal", text: `Order <code>${esc(e.orderId)}</code> created`, detail: "Waiting for the owner to approve in PayPal", at: e.at });
      break;

    case "approval_required":
      openApproval(e);
      break;

    case "approval_resolved":
      closeApproval();
      addEvent({ kind: e.approved ? "allow" : "block", glyph: e.approved ? "allow" : "block", label: "Owner", text: e.approved ? "Approved the payment" : "Denied the payment", at: e.at });
      if (e.approved) fire("wire-2", "send");
      setFlow(e.approved ? "allow" : "block", e.approved ? "Approved" : "Denied");
      break;

    case "payment_sent": {
      stats.paid++;
      stats.spent = e.spent;
      tickNum("c-allowed", stats.paid);
      renderBook();
      const isOrder = e.payment.kind === "order";
      $("paypal-sub").textContent = e.payment.simulated ? "simulated" : isOrder ? "order captured" : "payout sent";
      const ref = isOrder
        ? `Order <code>${esc(e.payment.id)}</code> captured${e.payment.captureId ? `, capture <code>${esc(e.payment.captureId)}</code>` : ""}`
        : `Payout batch <code>${esc(e.payment.id)}</code>`;
      addEvent({
        kind: "paid", label: "Paid",
        text: `PayPal paid ${payee(e.request)}`,
        detail: `${ref} · ${esc(e.payment.status)}${e.payment.simulated ? " (simulated)" : ""}`,
        amount: e.request.amount, at: e.at,
      });
      break;
    }

    case "payment_failed":
      addEvent({ kind: "block", glyph: "block", label: "Error", text: "PayPal rejected the request", detail: esc(e.error), at: e.at });
      break;

    case "agent_message":
      lastAgentText = e.text;
      addEvent({ kind: "agent", label: "Agent", text: mdLite(e.text), at: e.at });
      break;

    case "tool_result":
      if (e.tool === "view_product" && e.result?.page_text) pagesRead[e.result.product_id] = e.result.page_text;
      if (e.tool === "search_products" && e.result && !Array.isArray(e.result) && e.result.results?.length === 0) {
        addEvent({ kind: "nothing", label: "No match", text: "No supplier in the catalog sells this", detail: "The demo store only stocks café supplies.", at: e.at });
      }
      break;

    case "error":
      addEvent({ kind: "block", glyph: "block", label: "Error", text: "Run failed", detail: esc(e.error), at: e.at });
      break;

    case "done":
      addEvent({ kind: "done", label: "Done", text: `Run finished. Spent ${money(e.spent)}.`, at: e.at });
      $("live").hidden = true;
      $("agent-sub").textContent = "done";
      busy($("launch"), false, "Run again");
      Progress.done();
      $("edit").disabled = false;
      setStep(4);
      if (stats.attempts === 0) {
        // The agent never tried to pay: say so plainly instead of leaving the gate blank
        setFlow("idle", "Nothing bought");
        setVerdict("none", "Nothing bought", "", lastAgentText
          ? lastAgentText.replace(/\*\*/g, "").split("\n")[0].slice(0, 260)
          : "The agent did not find anything to buy, so no payment reached the gate.");
      } else if (["busy", "check"].includes($("flow").dataset.state)) {
        setFlow("idle", "Finished");
      }
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
      onApprove: () => answerApproval(true, "paypal"), // Leash captures server-side
      onError: (err) => addEvent({ kind: "block", glyph: "block", label: "Error", text: "PayPal error", detail: esc(err?.message || err) }),
    })
    .render(box);
  return true;
}
function openApproval(e) {
  pendingApproval = e.approvalId;
  $("approval-amount").textContent = money(e.request.amount);
  $("approval-body").innerHTML = `To ${payee(e.request)}<br><span class="ev-detail">${esc(e.request.justification)}</span>`;
  $("approval-reason").textContent = e.reason;
  $("approval-order").textContent = e.orderId ? `PayPal order ${e.orderId}` : "";
  const viaPayPal = renderPayPalApproval(e.orderId);
  $("approve").textContent = viaPayPal ? "Approve here instead" : "Approve and pay";
  $("paypal-hint").hidden = !viaPayPal;
  $("approval").hidden = false;
  $("deny").focus();
}
function closeApproval() {
  $("approval").hidden = true;
  $("paypal-buttons").innerHTML = "";
}
async function answerApproval(approved, via = "app") {
  if (!pendingApproval) return;
  const id = pendingApproval;
  pendingApproval = null;
  await fetch(`/api/approvals/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, via }),
  });
}
$("approve").addEventListener("click", () => answerApproval(true));
$("deny").addEventListener("click", () => answerApproval(false));
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !$("approval").hidden) answerApproval(false);
});

// ---------------- 4. audit ledger (AG Grid) ----------------
const KIND = { ALLOW: "allow", APPROVED: "allow", REVIEW: "review", BLOCK: "block", DENIED: "block" };

const grid = agGrid.createGrid($("audit-grid"), {
  rowData: [],
  columnDefs: [
    { field: "time", headerName: "Time", width: 96, cellClass: "cell-mono", valueFormatter: (p) => clock(p.value) },
    { field: "decision", width: 128, filter: true, cellRenderer: (p) => (p.value ? tag(KIND[p.value] || "review", p.value) : "") },
    { field: "amount", width: 104, cellClass: "cell-mono", type: "rightAligned", valueFormatter: (p) => money(p.value) },
    { field: "payee", width: 150, cellClass: "cell-mono", filter: true },
    { field: "productId", headerName: "Item", width: 92, cellClass: "cell-mono" },
    { field: "layer", headerName: "Decided by", width: 128, cellClass: "cell-mono", filter: true },
    { field: "injection", headerName: "Injection", width: 104, cellRenderer: (p) => (p.value ? '<span class="flag">Found</span>' : "") },
    { field: "reason", flex: 1, minWidth: 280, tooltipField: "reason", wrapText: true, autoHeight: true },
    { field: "paypalId", headerName: "PayPal ref", width: 190, cellClass: "cell-mono" },
    { field: "paypalStatus", headerName: "PayPal status", width: 170, cellClass: "cell-mono" },
  ],
  defaultColDef: { sortable: true, resizable: true },
  animateRows: true,
  overlayNoRowsTemplate: "No payment attempts yet.",
});
async function loadAudit() {
  Progress.start();
  try {
  const rows = await fetch("/api/audit", { headers: VH }).then((r) => r.json());
  grid.setGridOption("rowData", rows);
  } finally {
    Progress.done();
  }
}
$("refresh-audit").addEventListener("click", loadAudit);
loadAudit();

// ---------------- theme toggle (remembered per browser) ----------------
function currentTheme() {
  return document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function syncThemeButton() {
  $("theme").setAttribute("aria-label", currentTheme() === "dark" ? "Switch to light mode" : "Switch to dark mode");
}
$("theme").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("leash-theme", next); } catch {}
  syncThemeButton();
  window.LeashAnim?.mountGate($("lottie-gate")); // redraw the gate in the new colours
});
syncThemeButton();

// ---------------- first-visit splash + scroll reveal ----------------
(() => {
  const splash = document.getElementById("splash");
  const started = performance.now();
  const tag = document.querySelector(".tagline");
  if (tag) tag.innerHTML = tag.textContent.trim().split(/\s+/).map((w, i) =>
    `<span class="w"><span style="--i:${i}"${/paypal/i.test(w) ? ' class="hl"' : ""}>${esc(w)}</span></span>`).join(" ");
  const reveal = () => {
    const items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) { items.forEach((el) => el.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
    items.forEach((el, i) => { el.style.transitionDelay = `${Math.min(i, 4) * 60}ms`; io.observe(el); });
  };
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    Progress.done();
    let seen = false;
    try { seen = sessionStorage.getItem("leash-splash") === "1"; sessionStorage.setItem("leash-splash", "1"); } catch {}
    const wait = seen ? 0 : Math.max(0, 1100 - (performance.now() - started)); // show the logo draw once per visit
    setTimeout(() => {
      splash?.classList.add("hide");
      reveal();
      setTimeout(() => splash?.remove(), 500);
    }, wait);
  };
  window.addEventListener("load", finish);
  setTimeout(finish, 2500); // never hold the page behind the splash for long
})();
