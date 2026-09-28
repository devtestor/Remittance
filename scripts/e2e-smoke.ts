const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const adminEmail = process.env.ADMIN_DEV_EMAIL ?? "admin@velo.local";
const adminPassword = process.env.ADMIN_DEV_PASSWORD ?? "velo-admin-dev";

type Json = Record<string, unknown>;

async function request<T extends Json>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
  const body = await response.json() as T;
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

function expectStatus(value: unknown, expected: string, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} expected ${expected}, received ${String(value)}`);
  }
}

async function main(): Promise<void> {
const suffix = Date.now().toString();
const user = await request<{ id: string }>("/users", {
  method: "POST",
  body: JSON.stringify({
    email: `e2e-${suffix}@velo.local`,
    phoneNumber: `+1555${suffix.slice(-7)}`,
    countryCode: "US",
    kycStatus: "approved"
  })
});

const beneficiary = await request<{ id: string }>("/beneficiaries", {
  method: "POST",
  body: JSON.stringify({
    userId: user.id,
    displayName: "E2E Rwanda Recipient",
    countryCode: "RW",
    payoutMethod: "mobile_money",
    payoutToken: `+25078${suffix.slice(-6)}`
  })
});

const quote = await request<{ id: string }>("/transfer-quotes", {
  method: "POST",
  body: JSON.stringify({
    senderUserId: user.id,
    sourceAmount: { amountMinor: "10000", currency: "USD" },
    destinationCurrency: "RWF",
    exchangeRate: "1410.25",
    feeBasisPoints: 150,
    fixedFeeMinor: "99"
  })
});

const created = await request<{ id: string; status: string }>("/transfers", {
  method: "POST",
  headers: { "x-idempotency-key": `e2e-${suffix}` },
  body: JSON.stringify({
    senderUserId: user.id,
    beneficiaryId: beneficiary.id,
    quoteId: quote.id,
    paymentMethod: "card",
    payoutMethod: "mobile_money"
  })
});
expectStatus(created.status, "pending_payment", "created transfer");

const paid = await request<{ transfer: { status: string } }>(`/transfers/${created.id}/payment-received`, {
  method: "POST",
  body: "{}"
});
expectStatus(paid.transfer.status, "payment_received", "paid transfer");

const admin = await request<{ token: string }>("/admin/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: adminEmail, password: adminPassword })
});
const authHeaders = { authorization: `Bearer ${admin.token}` };

const submitted = await request<{ transfer: { status: string } }>(`/admin/transfers/${created.id}/provider-event`, {
  method: "POST",
  headers: { ...authHeaders, "x-idempotency-key": `e2e-provider-${suffix}` },
  body: JSON.stringify({ event: "payout_submitted", idempotencyKey: `e2e-provider-submit-${suffix}` })
});
expectStatus(submitted.transfer.status, "processing_payout", "submitted payout");

const completed = await request<{ transfer: { status: string } }>(`/admin/transfers/${created.id}/provider-event`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ event: "payout_completed", idempotencyKey: `e2e-provider-complete-${suffix}` })
});
expectStatus(completed.transfer.status, "completed", "completed payout");

const duplicate = await request<{ duplicate?: boolean }>(`/admin/transfers/${created.id}/provider-event`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ event: "payout_completed", idempotencyKey: `e2e-provider-complete-${suffix}` })
});
if (duplicate.duplicate !== true) {
  throw new Error("duplicate provider event was not reported as duplicate");
}

const failedQuote = await request<{ id: string }>("/transfer-quotes", {
  method: "POST",
  body: JSON.stringify({
    senderUserId: user.id,
    sourceAmount: { amountMinor: "12500", currency: "USD" },
    destinationCurrency: "RWF",
    exchangeRate: "1410.25",
    feeBasisPoints: 150,
    fixedFeeMinor: "99"
  })
});
const failedTransfer = await request<{ id: string; status: string }>("/transfers", {
  method: "POST",
  headers: { "x-idempotency-key": `e2e-failed-${suffix}` },
  body: JSON.stringify({
    senderUserId: user.id,
    beneficiaryId: beneficiary.id,
    quoteId: failedQuote.id,
    paymentMethod: "card",
    payoutMethod: "mobile_money"
  })
});
await request(`/transfers/${failedTransfer.id}/payment-received`, { method: "POST", body: "{}" });
await request(`/admin/transfers/${failedTransfer.id}/provider-event`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ event: "payout_submitted", idempotencyKey: `e2e-failed-submit-${suffix}` })
});
const failed = await request<{ transfer: { status: string } }>(`/admin/transfers/${failedTransfer.id}/provider-event`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ event: "payout_failed", idempotencyKey: `e2e-failed-fail-${suffix}` })
});
expectStatus(failed.transfer.status, "failed", "failed payout");
const failedDetail = await request<{ transfer: { ledgerTransactions: Array<{ memo: string }> } }>(`/admin/transfers/${failedTransfer.id}`, {
  headers: authHeaders
});
if (!failedDetail.transfer.ledgerTransactions.some((entry) => entry.memo.includes("Refund for failed payout"))) {
  throw new Error("failed payout did not post a refund ledger transaction");
}
const providerMetrics = await request<{ processed: number; retryable: number }>("/admin/provider-events/metrics", {
  headers: authHeaders
});
if (providerMetrics.processed < 3 || providerMetrics.retryable < 0) {
  throw new Error("provider event metrics did not report the rehearsal events");
}

console.log(`E2E smoke passed for transfer ${created.id}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
