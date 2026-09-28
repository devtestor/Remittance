export type HealthResponse = {
  status: "ok";
  service: string;
  timestamp: string;
};

export type CurrencyCode = "USD" | "RWF" | "KES" | "UGX" | "TZS" | "CDF";

export type Money = {
  amountMinor: string;
  currency: CurrencyCode;
};

export type CountryCode = "US" | "RW" | "KE" | "UG" | "TZ" | "CD";

export type UserRole = "sender" | "admin" | "compliance";

export type KycStatus = "not_started" | "pending" | "approved" | "rejected" | "expired";

export type UserProfile = {
  id: string;
  role: UserRole;
  email: string;
  phoneNumber?: string;
  countryCode: CountryCode;
  kycStatus: KycStatus;
  createdAt: string;
  updatedAt: string;
};

export type TransferStatus =
  | "draft"
  | "quoted"
  | "pending_payment"
  | "payment_received"
  | "under_review"
  | "processing_payout"
  | "completed"
  | "failed"
  | "cancelled";

export type PaymentMethod = "card" | "bank_account" | "mobile_money" | "crypto_wallet";

export type PayoutMethod = "mobile_money" | "bank_account" | "crypto_wallet";

export type TransferFailureReason =
  | "payment_failed"
  | "payout_failed"
  | "compliance_rejected"
  | "expired"
  | "cancelled_by_user"
  | "cancelled_by_admin";

export type Transfer = {
  id: string;
  senderUserId: string;
  beneficiaryId: string;
  sourceAmount: Money;
  destinationAmount: Money;
  feeAmount: Money;
  exchangeRate: string;
  paymentMethod: PaymentMethod;
  payoutMethod: PayoutMethod;
  status: TransferStatus;
  failureReason?: TransferFailureReason;
  createdAt: string;
  updatedAt: string;
};

export type TransferQuote = {
  id: string;
  sourceAmount: Money;
  destinationAmount: Money;
  feeAmount: Money;
  exchangeRate: string;
  expiresAt: string;
};

export type Beneficiary = {
  id: string;
  userId: string;
  displayName: string;
  countryCode: CountryCode;
  payoutMethod: PayoutMethod;
  createdAt: string;
};

export type ProviderEvent = {
  id: string;
  provider: string;
  eventType: string;
  idempotencyKey: string;
  receivedAt: string;
  processedAt?: string;
};
