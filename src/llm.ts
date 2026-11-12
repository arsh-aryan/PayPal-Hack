import OpenAI from "openai";

// Any OpenAI-compatible provider. Groq exposes the same API at a different base URL.
const PROVIDERS = {
  openai: { baseURL: undefined, keyVar: "OPENAI_API_KEY", defaultModel: "gpt-5-mini" },
  groq: { baseURL: "https://api.groq.com/openai/v1", keyVar: "GROQ_API_KEY", defaultModel: "openai/gpt-oss-120b" },
} as const;

type ProviderName = keyof typeof PROVIDERS;

export function providerName(): ProviderName {
  const p = (process.env.AI_PROVIDER || "").toLowerCase();
  if (p === "groq" || p === "openai") return p;
  return process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY ? "groq" : "openai";
}

export function aiConfigured(): boolean {
  return Boolean(process.env[PROVIDERS[providerName()].keyVar]);
}

let client: OpenAI | null = null;

export function openai(): OpenAI {
  const p = PROVIDERS[providerName()];
  const apiKey = process.env[p.keyVar];
  if (!apiKey) throw new Error(`${p.keyVar} is not set (see .env.example)`);
  client ??= new OpenAI({ apiKey, baseURL: p.baseURL, maxRetries: 6 }); // rides out free-tier rate limits
  return client;
}

export const model = () =>
  process.env.AI_MODEL ||
  (providerName() === "openai" ? process.env.OPENAI_MODEL : undefined) ||
  PROVIDERS[providerName()].defaultModel;

// Groq free-tier quotas are per model, so a second model keeps the demo alive
// when the main model's DAILY token quota is used up.
const fallbackModel = () =>
  process.env.AI_FALLBACK_MODEL || (providerName() === "groq" ? "openai/gpt-oss-20b" : undefined);

const exhaustedUntil = new Map<string, number>();
const isDailyLimit = (e: unknown) =>
  e instanceof OpenAI.APIError && e.status === 429 && /per day|\(TPD\)|\(RPD\)/i.test(e.message);

type ChatParams = Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, "model">;

/** Chat completion with automatic fallback to a second model when the first hits its daily quota. */
export async function chat(params: ChatParams): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const candidates = [model(), fallbackModel()].filter((m): m is string => Boolean(m));
  const usable = candidates.filter((m) => (exhaustedUntil.get(m) ?? 0) < Date.now());
  const order = usable.length ? usable : candidates;
  let lastError: unknown;
  for (const m of order) {
    try {
      try {
        // First attempt without SDK retries, so a used-up daily quota falls back at once
        return await openai().chat.completions.create({ ...params, model: m }, { maxRetries: 0 });
      } catch (e) {
        if (isDailyLimit(e)) throw e;
        // Per-minute limits and transient errors: retry with the client's backoff
        return await openai().chat.completions.create({ ...params, model: m });
      }
    } catch (e) {
      lastError = e;
      if (!isDailyLimit(e)) throw e;
      exhaustedUntil.set(m, Date.now() + 60 * 60_000);
      console.warn(`[llm] ${m} hit its daily quota; falling back`);
    }
  }
  throw lastError;
}

export const activeModel = () => {
  const m = model();
  return (exhaustedUntil.get(m) ?? 0) > Date.now() ? fallbackModel() ?? m : m;
};

/** Ask the model for a JSON object that matches `schema`. Falls back to JSON mode if strict schemas are unsupported. */
export async function jsonCompletion<T>(opts: {
  name: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
}): Promise<T> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  let content: string | null | undefined;
  try {
    const res = await chat({
      messages,
      response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema: opts.schema } },
    });
    content = res.choices[0]?.message?.content;
  } catch (e) {
    if (!(e instanceof OpenAI.APIError) || e.status !== 400) throw e;
    const res = await chat({
      messages: [
        { role: "system", content: `${opts.system}\n\nRespond ONLY with a JSON object matching this JSON schema:\n${JSON.stringify(opts.schema)}` },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_object" },
    });
    content = res.choices[0]?.message?.content;
  }
  if (!content) throw new Error(`Empty response for ${opts.name}`);
  return JSON.parse(content) as T;
}
