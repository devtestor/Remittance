export type ProviderRetryDecision = "retry" | "exhausted";

export function getProviderRetryDecision(retryCount: number, maxRetries: number): ProviderRetryDecision {
  return retryCount >= maxRetries ? "exhausted" : "retry";
}
