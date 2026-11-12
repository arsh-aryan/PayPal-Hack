import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export type Decision = "ALLOW" | "BLOCK" | "REVIEW" | "APPROVED" | "DENIED";

export interface AuditEntry {
  id: string;
  time: string;
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

export const audit: AuditEntry[] = [];

export function addAudit(e: Omit<AuditEntry, "id" | "time">): AuditEntry {
  const entry = { id: randomUUID(), time: new Date().toISOString(), ...e };
  audit.unshift(entry);
  return entry;
}

export interface Run {
  id: string;
  events: EventEmitter;
  history: unknown[]; // replayed to late SSE subscribers
  spent: number;
  done: boolean;
}

export const runs = new Map<string, Run>();

export function createRun(): Run {
  const run: Run = { id: randomUUID().slice(0, 8), events: new EventEmitter(), history: [], spent: 0, done: false };
  runs.set(run.id, run);
  return run;
}

export function emit(run: Run, event: Record<string, unknown>) {
  const e = { ...event, at: new Date().toISOString() };
  run.history.push(e);
  run.events.emit("event", e);
}

// Pending human approvals: id -> resolver
const pending = new Map<string, (approved: boolean) => void>();

export function waitForApproval(id: string, timeoutMs = 15 * 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(false);
    }, timeoutMs);
    pending.set(id, (ok) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(ok);
    });
  });
}

export function resolveApproval(id: string, approved: boolean): boolean {
  const r = pending.get(id);
  if (!r) return false;
  r(approved);
  return true;
}
