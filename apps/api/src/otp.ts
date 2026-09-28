import type { AppConfig } from "@glr/config";

export async function deliverOtp(
  config: AppConfig,
  input: { phoneNumber: string; code: string }
): Promise<void> {
  if (config.otpProvider === "console") {
    console.log(`[otp:console] ${input.phoneNumber}: ${input.code}`);
    return;
  }

  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFromNumber) {
    throw new Error("Twilio OTP configuration is incomplete");
  }

  const credentials = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        To: input.phoneNumber,
        From: config.twilioFromNumber,
        Body: `Your Velo verification code is ${input.code}. It expires in 10 minutes.`
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Twilio OTP delivery failed with status ${response.status}`);
  }
}
