import type { AppConfig } from "@glr/config";

export async function deliverAdminTemporaryPassword(
  config: AppConfig,
  input: { email: string; temporaryPassword: string }
): Promise<void> {
  if (config.adminPasswordDelivery === "console") {
    if (config.nodeEnv === "development") {
      console.log(`[admin-password:console] ${input.email}: ${input.temporaryPassword}`);
    }
    return;
  }

  if (!config.resendApiKey || !config.adminPasswordFromEmail) {
    throw new Error("Resend password delivery is not configured");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: config.adminPasswordFromEmail,
      to: [input.email],
      subject: "Your Velo Control temporary password",
      text: `Your Velo Control temporary password is: ${input.temporaryPassword}\n\nSign in and change it immediately.`
    })
  });

  if (!response.ok) {
    throw new Error(`Admin password delivery failed with status ${response.status}`);
  }
}
