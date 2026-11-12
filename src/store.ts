import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export type Decision = "ALLOW" | "BLOCK" | "REVIEW" | "APPROVED" | "DENIED";

export interface AuditEntry {
  id: string;
  time: string;
  visitorId: string; // each browser only sees its own rows
  runId: string;
  payee: string;
  amount: number;
  currency: string;
  productId: string;
  decision: Decision;
  layer: string; // "rules", "ai-judge", "user"
  reason: string;
  injection: boolean;
  paypalId: string;
  paypalStatus: string;
}

const audit: AuditEntry[] = [];

export function addAudit(e: Omit<AuditEntry, "id" | "time">): AuditEntry {
  const entry = { id: randomUUID(), time: new Date().toISOString(), ...e };
  audit.unshift(entry);
  if (audit.length > 2000) audit.length = 2000; // keep memory bounded on the shared demo
  return entry;
}

export const auditFor = (visitorId: string) => audit.filter((a) => a.visitorId === visitorId);

export interface Run {
  id: string;
  visitorId: string;
  events: EventEmitter;
  history: unknown[]; // replayed to late SSE subscribers
  spent: number;
  done: boolean;
}

export const runs = new Map<string, Run>();

export function createRun(visitorId: string): Run {
  const run: Run = { id: randomUUID().slice(0, 8), visitorId, events: new EventEmitter(), history: [], spent: 0, done: false };
  runs.set(run.id, run);
  return run;
}

export function emit(run: Run, event: Record<string, unknown>) {
  const e = { ...event, at: new Date().toISOString() };
  run.history.push(e);
  run.events.emit("event", e);
}

// Pending human approvals. `via` says how the owner approved:
// "paypal" = in PayPal's buyer popup (order can be captured), "app" = the in-app button.
export type ApprovalResult = { approved: boolean; via: "paypal" | "app" };
const pending = new Map<string, (r: ApprovalResult) => void>();

export function waitForApproval(id: string, timeoutMs = 15 * 60_000): Promise<ApprovalResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ approved: false, via: "app" });
    }, timeoutMs);
    pending.set(id, (r) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(r);
    });
  });
}

export function resolveApproval(id: string, result: ApprovalResult): boolean {
  const r = pending.get(id);
  if (!r) return false;
  r(result);
  return true;
}
