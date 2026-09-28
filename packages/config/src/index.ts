export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  apiPort: number;
  otpProvider: "console" | "twilio";
  kycProvider: "manual" | "smile";
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  adminApiKey?: string;
  adminPasswordDelivery: "console" | "resend";
  resendApiKey?: string;
  adminPasswordFromEmail?: string;
  smilePartnerId?: string;
  smileApiKey?: string;
  smileCallbackUrl?: string;
  smileSidServer: "0" | "1";
};

export function getConfig(): AppConfig {
  const config: AppConfig = {
    nodeEnv: parseNodeEnv(process.env.NODE_ENV),
    apiPort: parsePort(process.env.API_PORT, 4000),
    otpProvider: parseOtpProvider(process.env.OTP_PROVIDER),
    kycProvider: parseKycProvider(process.env.KYC_PROVIDER),
    adminPasswordDelivery: process.env.ADMIN_PASSWORD_DELIVERY === "resend" ? "resend" : "console",
    ...(process.env.TWILIO_ACCOUNT_SID ? { twilioAccountSid: process.env.TWILIO_ACCOUNT_SID } : {}),
    ...(process.env.TWILIO_AUTH_TOKEN ? { twilioAuthToken: process.env.TWILIO_AUTH_TOKEN } : {}),
    ...(process.env.TWILIO_FROM_NUMBER ? { twilioFromNumber: process.env.TWILIO_FROM_NUMBER } : {}),
    ...(process.env.ADMIN_API_KEY || parseNodeEnv(process.env.NODE_ENV) === "development"
      ? { adminApiKey: process.env.ADMIN_API_KEY ?? "dev-admin-key" }
      : {}),
    ...(process.env.SMILE_PARTNER_ID ? { smilePartnerId: process.env.SMILE_PARTNER_ID } : {}),
    ...(process.env.SMILE_API_KEY ? { smileApiKey: process.env.SMILE_API_KEY } : {}),
    ...(process.env.SMILE_CALLBACK_URL ? { smileCallbackUrl: process.env.SMILE_CALLBACK_URL } : {}),
    ...(process.env.RESEND_API_KEY ? { resendApiKey: process.env.RESEND_API_KEY } : {}),
    ...(process.env.ADMIN_PASSWORD_FROM_EMAIL ? { adminPasswordFromEmail: process.env.ADMIN_PASSWORD_FROM_EMAIL } : {}),
    smileSidServer: process.env.SMILE_SID_SERVER === "1" ? "1" : "0"
  };

  if (config.nodeEnv === "production" && config.otpProvider === "console") {
    throw new Error("OTP_PROVIDER must be twilio in production");
  }

  if (config.nodeEnv === "production" && config.adminPasswordDelivery !== "resend") {
    throw new Error("ADMIN_PASSWORD_DELIVERY must be resend in production");
  }

  if (config.adminPasswordDelivery === "resend" && (!config.resendApiKey || !config.adminPasswordFromEmail)) {
    throw new Error("RESEND_API_KEY and ADMIN_PASSWORD_FROM_EMAIL are required for Resend password delivery");
  }

  if (
    config.kycProvider === "smile" &&
    (!config.smilePartnerId || !config.smileApiKey || !config.smileCallbackUrl)
  ) {
    throw new Error("SMILE_PARTNER_ID, SMILE_API_KEY, and SMILE_CALLBACK_URL must be configured when KYC_PROVIDER=smile");
  }

  return config;
}

function parseNodeEnv(value: string | undefined): AppConfig["nodeEnv"] {
  if (value === "test" || value === "production") {
    return value;
  }

  return "development";
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOtpProvider(value: string | undefined): AppConfig["otpProvider"] {
  return value === "twilio" ? "twilio" : "console";
}

function parseKycProvider(value: string | undefined): AppConfig["kycProvider"] {
  return value === "smile" ? "smile" : "manual";
}
