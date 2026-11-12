// Minimal PayPal sandbox client: OAuth + Payouts API.
// Payouts lets the agent's spending wallet (your sandbox business account)
// pay a merchant without a human clicking "Approve" — the firewall is the approver.

const BASE = "https://api-m.sandbox.paypal.com";

let cachedToken: { value: string; expiresAt: number } | null = null;

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PayPal ${method} ${path} failed (${res.status}): ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export interface PaymentResult {
  id: string;
  status: string;
  simulated: boolean;
}

export async function sendPayment(p: {
  receiverEmail: string;
  amount: number;
  currency: string;
  note: string;
  reference: string;
}): Promise<PaymentResult> {
  if (!paypalConfigured()) {
    return { id: `SIM-${p.reference}`, status: "SIMULATED", simulated: true };
  }
  const data = await call<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
    "POST",
    "/v1/payments/payouts",
    {
      sender_batch_header: {
        sender_batch_id: p.reference,
        email_subject: "You have a payment from a Leash-protected agent",
        email_message: p.note,
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: p.receiverEmail,
          amount: { value: p.amount.toFixed(2), currency: p.currency },
          note: p.note,
          sender_item_id: p.reference,
        },
      ],
    },
  );
  return { id: data.batch_header.payout_batch_id, status: data.batch_header.batch_status, simulated: false };
}

export async function getPaymentStatus(batchId: string): Promise<string> {
  if (!paypalConfigured() || batchId.startsWith("SIM-")) return "SIMULATED";
  const data = await call<{ batch_header: { batch_status: string } }>(
    "GET",
    `/v1/payments/payouts/${batchId}`,
  );
  return data.batch_header.batch_status;
}

// ---------- Orders v2: used when Leash escalates a payment to the human ----------
// The owner approves in PayPal's own buyer-approval popup (JS SDK), then Leash captures.

export async function createOrder(p: {
  amount: number;
  currency: string;
  description: string;
  reference: string;
}): Promise<{ id: string; status: string }> {
  return call<{ id: string; status: string }>("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: p.reference.slice(0, 256),
        custom_id: p.reference.slice(0, 127),
        description: p.description.slice(0, 127),
        amount: { currency_code: p.currency, value: p.amount.toFixed(2) },
      },
    ],
  });
}

export async function captureOrder(orderId: string): Promise<{ id: string; status: string; captureId?: string }> {
  const data = await call<{
    id: string;
    status: string;
    purchase_units?: { payments?: { captures?: { id: string; status: string }[] } }[];
  }>("POST", `/v2/checkout/orders/${orderId}/capture`, {});
  return { id: data.id, status: data.status, captureId: data.purchase_units?.[0]?.payments?.captures?.[0]?.id };
}
