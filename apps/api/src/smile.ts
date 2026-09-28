import type { AppConfig } from "@glr/config";
import { Signature, WebApi } from "smile-identity-core";

export type SmileKycToken = {
  provider: "smile";
  userId: string;
  jobId: string;
  token: string;
};

export type SmileCallbackDecision =
  | {
      jobId: string;
      status: "approved" | "rejected";
      rejectionReason?: string;
    }
  | {
      jobId: string;
      status: "pending";
    };

export function assertSmileConfigured(config: AppConfig): asserts config is AppConfig & {
  smilePartnerId: string;
  smileApiKey: string;
  smileCallbackUrl: string;
} {
  if (!config.smilePartnerId || !config.smileApiKey || !config.smileCallbackUrl) {
    throw new SmileConfigurationError();
  }
}

export async function createSmileKycToken(
  config: AppConfig,
  input: { userId: string; jobId: string }
): Promise<SmileKycToken> {
  assertSmileConfigured(config);

  const client = new WebApi(
    config.smilePartnerId,
    config.smileCallbackUrl,
    config.smileApiKey,
    config.smileSidServer
  );
  const result = await client.get_web_token({
    user_id: input.userId,
    job_id: input.jobId,
    product: "doc_verification",
    callback_url: config.smileCallbackUrl
  });

  return {
    provider: "smile",
    userId: input.userId,
    jobId: input.jobId,
    token: result.token
  };
}

export function parseSmileCallback(config: AppConfig, payload: Record<string, unknown>): SmileCallbackDecision {
  assertSmileConfigured(config);

  if (!confirmSmileSignature(config, payload)) {
    throw new SmileSignatureError();
  }

  const partnerParams = asRecord(payload.partner_params ?? payload.PartnerParams);
  const jobId = readString(partnerParams.job_id ?? partnerParams.jobId);

  if (!jobId) {
    throw new SmileCallbackError("Smile callback did not include partner_params.job_id");
  }

  const resultCode = readString(payload.ResultCode ?? payload.result_code);
  const resultText = readString(payload.ResultText ?? payload.result_text);
  const passed = hasFailedAction(payload) ? false : hasApprovedSignal(payload, resultCode);
  const completed = hasCompletedSignal(payload, resultCode);

  if (passed) {
    return { jobId, status: "approved" };
  }

  if (completed) {
    return {
      jobId,
      status: "rejected",
      ...(resultText ? { rejectionReason: resultText } : { rejectionReason: "Smile ID verification was not approved" })
    };
  }

  return { jobId, status: "pending" };
}

export class SmileConfigurationError extends Error {
  constructor() {
    super("Smile ID is not configured");
  }
}

export class SmileSignatureError extends Error {
  constructor() {
    super("Smile ID callback signature is invalid");
  }
}

export class SmileCallbackError extends Error {}

function confirmSmileSignature(config: AppConfig, payload: Record<string, unknown>): boolean {
  const timestamp = payload.timestamp ?? payload.Timestamp;
  const signature = payload.signature ?? payload.Signature;

  if ((typeof timestamp !== "string" && typeof timestamp !== "number") || typeof signature !== "string") {
    return false;
  }

  assertSmileConfigured(config);
  return new Signature(config.smilePartnerId, config.smileApiKey).confirm_signature(timestamp, signature);
}

function hasApprovedSignal(payload: Record<string, unknown>, resultCode: string | undefined): boolean {
  if (resultCode === "0810" || resultCode === "0820") {
    return true;
  }

  const resultText = readString(payload.ResultText ?? payload.result_text)?.toLowerCase();
  const jobComplete = readString(payload.JobComplete ?? payload.job_complete)?.toLowerCase();
  const actions = asRecord(payload.Actions ?? payload.actions);

  return (
    jobComplete === "true" &&
    (resultText === "approved" || Object.values(actions).some((value) => readString(value)?.toLowerCase() === "approved"))
  );
}

function hasCompletedSignal(payload: Record<string, unknown>, resultCode: string | undefined): boolean {
  const jobComplete = readString(payload.JobComplete ?? payload.job_complete)?.toLowerCase();
  return jobComplete === "true" || Boolean(resultCode);
}

function hasFailedAction(payload: Record<string, unknown>): boolean {
  const actions = asRecord(payload.Actions ?? payload.actions);
  return Object.values(actions).some((value) => {
    const text = readString(value)?.toLowerCase();
    return text === "failed" || text === "rejected";
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
