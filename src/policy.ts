import { jsonCompletion } from "./llm.js";
import { merchants } from "./catalog.js";

export interface Policy {
  goal: string;
  currency: string;
  max_total: number;
  max_per_purchase: number;
  approval_threshold: number;
  allowed_categories: string[];
  blocked_merchants: string[];
  require_returns: boolean;
  summary: string;
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "goal",
    "currency",
    "max_total",
    "max_per_purchase",
    "approval_threshold",
    "allowed_categories",
    "blocked_merchants",
    "require_returns",
    "summary",
  ],
  properties: {
    goal: { type: "string", description: "What the user wants the agent to buy, in one sentence." },
    currency: { type: "string", description: "ISO currency code, default USD." },
    max_total: { type: "number", description: "Max total spend for this mandate." },
    max_per_purchase: { type: "number", description: "Max for any single payment. Default = max_total." },
    approval_threshold: {
      type: "number",
      description: "Payments ABOVE this amount need the user's approval. If not stated, use 80% of max_total.",
    },
    allowed_categories: {
      type: "array",
      items: { type: "string", enum: ["electronics", "home", "clothing", "food", "travel", "other"] },
      description: "Categories the agent may buy in. Infer from the goal.",
    },
    blocked_merchants: {
      type: "array",
      items: { type: "string" },
      description: "Merchant ids the user explicitly excluded.",
    },
    require_returns: { type: "boolean", description: "True if user wants only merchants that accept returns." },
    summary: { type: "string", description: "Plain-English one-paragraph restatement of the rules for the user to confirm." },
  },
};

export async function compileMandate(mandate: string): Promise<Policy> {
  const policy = await jsonCompletion<Policy>({
    name: "spending_policy",
    system:
      "You convert a user's plain-English shopping instruction for an AI agent into a strict, conservative spending policy. " +
      "Never invent permissions the user did not grant. When unsure, choose the safer (lower / stricter) value. " +
      "Category guide: computers, keyboards, headphones, phones, gadgets -> electronics; lamps, furniture, decor, kitchenware -> home; " +
      "apparel and shoes -> clothing. Include only the categories the requested item belongs to. " +
      `Known merchant ids: ${merchants.map((m) => `${m.id} (${m.name})`).join(", ")}.`,
    user: mandate,
    schema,
  });
  policy.max_per_purchase = Math.min(policy.max_per_purchase || policy.max_total, policy.max_total);
  policy.approval_threshold = Math.min(policy.approval_threshold, policy.max_per_purchase);
  return policy;
}
