export type ApiUser = {
  id: string;
  email: string;
  countryCode: string;
  kycStatus: string;
};

export type ApiBeneficiary = {
  id: string;
  displayName: string;
  countryCode: string;
  payoutMethod: string;
};

export type ApiQuote = {
  id: string;
  sourceAmount: {
    amountMinor: string;
    currency: string;
  };
  destinationAmount: {
    amountMinor: string;
    currency: string;
  };
  feeAmount: {
    amountMinor: string;
    currency: string;
  };
  exchangeRate: string;
  expiresAt: string;
};

export type ApiTransfer = {
  id: string;
  status: string;
  sourceAmount: {
    amountMinor: string;
    currency: string;
  };
  destinationAmount: {
    amountMinor: string;
    currency: string;
  };
  feeAmount: {
    amountMinor: string;
    currency: string;
  };
};

export type ApiWalletSummary = {
  userId: string;
  balances: Array<{
    amountMinor: string;
    currency: string;
  }>;
};

export type ApiSession = {
  token: string;
  expiresAt: string;
  user: ApiUser;
};

export type ApiOtpChallenge = {
  challengeId: string;
  expiresAt: string;
  devCode?: string;
};

export type ApiKycCase = {
  id: string;
  userId: string;
  status: string;
  legalName?: string;
  documentType?: string;
  provider?: string;
  providerCaseId?: string;
  submittedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
};

export type ApiSmileKycSession = {
  provider: "smile";
  userId: string;
  jobId: string;
  token: string;
};

export type DemoFlowResult = {
  user: ApiUser;
  beneficiary: ApiBeneficiary;
  quote: ApiQuote;
  transfer: ApiTransfer;
  paidTransfer: ApiTransfer;
};

export type CreateUserInput = {
  email: string;
  phoneNumber: string;
  countryCode: "US" | "RW" | "KE" | "UG" | "TZ" | "CD";
};

export type CreateBeneficiaryInput = {
  userId: string;
  displayName: string;
  countryCode: "US" | "RW" | "KE" | "UG" | "TZ" | "CD";
  payoutMethod: "mobile_money" | "bank_account" | "crypto_wallet";
  payoutToken: string;
};

export type CreateQuoteInput = {
  senderUserId: string;
  sourceAmount: {
    amountMinor: string;
    currency: "USD" | "RWF" | "KES" | "UGX" | "TZS" | "CDF";
  };
  destinationCurrency: "USD" | "RWF" | "KES" | "UGX" | "TZS" | "CDF";
  exchangeRate: string;
  feeBasisPoints: number;
  fixedFeeMinor: string;
};

export type CreateTransferInput = {
  senderUserId: string;
  beneficiaryId: string;
  quoteId: string;
  paymentMethod: "card" | "bank_account" | "mobile_money" | "crypto_wallet";
  payoutMethod: "mobile_money" | "bank_account" | "crypto_wallet";
};

export async function createUser(apiBaseUrl: string, input: CreateUserInput): Promise<ApiUser> {
  return post<ApiUser>(apiBaseUrl, "/users", {
    ...input,
    kycStatus: "approved"
  });
}

export async function findUserByEmail(apiBaseUrl: string, email: string): Promise<ApiUser | null> {
  const payload = await get<{ user: ApiUser | null }>(apiBaseUrl, `/users?email=${encodeURIComponent(email)}`);
  return payload.user;
}

export async function getWalletSummary(apiBaseUrl: string, userId: string): Promise<ApiWalletSummary> {
  return get<ApiWalletSummary>(apiBaseUrl, `/wallets/${encodeURIComponent(userId)}/summary`);
}

export async function createSession(apiBaseUrl: string, userId: string): Promise<ApiSession> {
  return post<ApiSession>(apiBaseUrl, "/sessions", { userId });
}

export async function restoreSession(apiBaseUrl: string, token: string): Promise<ApiUser> {
  const payload = await get<{ user: ApiUser }>(apiBaseUrl, `/sessions/${encodeURIComponent(token)}`);
  return payload.user;
}

export async function requestOtp(
  apiBaseUrl: string,
  input: { email: string; phoneNumber: string; countryCode: "US" | "RW" | "KE" | "UG" | "TZ" | "CD" }
): Promise<ApiOtpChallenge> {
  return post<ApiOtpChallenge>(apiBaseUrl, "/auth/otp/request", input);
}

export async function verifyOtp(
  apiBaseUrl: string,
  input: { challengeId: string; code: string }
): Promise<ApiSession> {
  return post<ApiSession>(apiBaseUrl, "/auth/otp/verify", input);
}

export async function getKycStatus(
  apiBaseUrl: string,
  userId: string
): Promise<{ user: ApiUser; kycCase: ApiKycCase | null }> {
  return get<{ user: ApiUser; kycCase: ApiKycCase | null }>(apiBaseUrl, `/users/${encodeURIComponent(userId)}/kyc`);
}

export async function submitKyc(
  apiBaseUrl: string,
  userId: string,
  input: { legalName: string; documentType: "national_id" | "passport" | "drivers_license" }
): Promise<{ user: ApiUser; kycCase: ApiKycCase }> {
  return post<{ user: ApiUser; kycCase: ApiKycCase }>(apiBaseUrl, `/users/${encodeURIComponent(userId)}/kyc`, input);
}

export async function createSmileKycSession(
  apiBaseUrl: string,
  userId: string,
  input: { legalName: string; documentType: "national_id" | "passport" | "drivers_license" }
): Promise<{ user: ApiUser; kycCase: ApiKycCase; smile?: ApiSmileKycSession }> {
  return post<{ user: ApiUser; kycCase: ApiKycCase; smile?: ApiSmileKycSession }>(
    apiBaseUrl,
    `/users/${encodeURIComponent(userId)}/kyc/smile-token`,
    input
  );
}

export async function createBeneficiary(
  apiBaseUrl: string,
  input: CreateBeneficiaryInput
): Promise<ApiBeneficiary> {
  return post<ApiBeneficiary>(apiBaseUrl, "/beneficiaries", input);
}

export async function createQuote(apiBaseUrl: string, input: CreateQuoteInput): Promise<ApiQuote> {
  return post<ApiQuote>(apiBaseUrl, "/transfer-quotes", input);
}

export async function createTransfer(apiBaseUrl: string, input: CreateTransferInput): Promise<ApiTransfer> {
  return post<ApiTransfer>(apiBaseUrl, "/transfers", input);
}

export async function markPaymentReceived(apiBaseUrl: string, transferId: string): Promise<ApiTransfer> {
  const paid = await post<{ transfer: ApiTransfer }>(
    apiBaseUrl,
    `/transfers/${transferId}/payment-received`,
    {}
  );

  return paid.transfer;
}

export async function listBeneficiaries(apiBaseUrl: string, userId: string): Promise<ApiBeneficiary[]> {
  const payload = await get<{ beneficiaries: ApiBeneficiary[] }>(
    apiBaseUrl,
    `/beneficiaries?userId=${encodeURIComponent(userId)}`
  );

  return payload.beneficiaries;
}

export async function listTransfers(apiBaseUrl: string, senderUserId: string): Promise<ApiTransfer[]> {
  const payload = await get<{ transfers: ApiTransfer[] }>(
    apiBaseUrl,
    `/transfers?senderUserId=${encodeURIComponent(senderUserId)}`
  );

  return payload.transfers;
}

export async function runDemoTransfer(apiBaseUrl: string): Promise<DemoFlowResult> {
  const suffix = Date.now();
  const user = await createUser(apiBaseUrl, {
    email: `sender-${suffix}@example.com`,
    phoneNumber: `+1555${String(suffix).slice(-7)}`,
    countryCode: "US"
  });

  const beneficiary = await createBeneficiary(apiBaseUrl, {
    userId: user.id,
    displayName: "Aline Mukamana",
    countryCode: "RW",
    payoutMethod: "mobile_money",
    payoutToken: "momo:test"
  });

  const quote = await createQuote(apiBaseUrl, {
    senderUserId: user.id,
    sourceAmount: {
      amountMinor: "10000",
      currency: "USD"
    },
    destinationCurrency: "RWF",
    exchangeRate: "1410.25",
    feeBasisPoints: 150,
    fixedFeeMinor: "99"
  });

  const transfer = await createTransfer(apiBaseUrl, {
    senderUserId: user.id,
    beneficiaryId: beneficiary.id,
    quoteId: quote.id,
    paymentMethod: "card",
    payoutMethod: "mobile_money"
  });

  const paidTransfer = await markPaymentReceived(apiBaseUrl, transfer.id);

  return {
    user,
    beneficiary,
    quote,
    transfer,
    paidTransfer
  };
}

async function post<T>(apiBaseUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return payload as T;
}

async function get<T>(apiBaseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return payload as T;
}
