import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  createBeneficiary,
  createQuote,
  createTransfer,
  createSmileKycSession,
  createUser,
  findUserByEmail,
  getWalletSummary,
  getKycStatus,
  listBeneficiaries,
  listTransfers,
  markPaymentReceived,
  requestOtp,
  restoreSession,
  submitKyc,
  verifyOtp,
  type ApiBeneficiary,
  type ApiQuote,
  type ApiTransfer,
  type ApiUser,
  type ApiOtpChallenge,
  type ApiKycCase,
  type ApiSmileKycSession,
  type ApiWalletSummary
} from "./api";
import { AppShell, Card, GhostButton, LabeledInput, Metric, Pill, PrimaryButton, Row } from "./components";
import { colors, radius } from "./theme";

type Screen = "onboarding" | "kyc" | "home" | "send" | "review" | "status" | "history";

type Draft = {
  sendAmount: string;
  recipientName: string;
  phoneNumber: string;
  senderEmail: string;
  senderPhoneNumber: string;
};

type FlowState = {
  user: ApiUser | null;
  beneficiary: ApiBeneficiary | null;
  quote: ApiQuote | null;
  transfer: ApiTransfer | null;
};

const defaultApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? (
  Platform.OS === "android" ? "http://10.0.2.2:4000" : "http://localhost:4000"
);
const sessionStorageKey = "velo.session.token";
const smileWidgetScriptUrl = "https://cdn.smileidentity.com/js/v11/smart-camera-web.js";
const smilePartnerId = process.env.EXPO_PUBLIC_SMILE_PARTNER_ID ?? "";
const smileCallbackUrl = process.env.EXPO_PUBLIC_SMILE_CALLBACK_URL ?? "";
const smilePolicyUrl = process.env.EXPO_PUBLIC_SMILE_POLICY_URL ?? "";
const smileLogoUrl = process.env.EXPO_PUBLIC_SMILE_LOGO_URL ?? "";
const smileEnvironment = process.env.EXPO_PUBLIC_SMILE_ENVIRONMENT === "production" ? "production" : "sandbox";

type SmileIdentityOptions = {
  token: string;
  product: "doc_verification";
  callback_url: string;
  environment: "sandbox" | "production";
  partner_details: {
    partner_id: string;
    name: string;
    logo_url: string;
    policy_url: string;
    theme_color: string;
  };
  partner_params: {
    user_id: string;
    job_id: string;
  };
  onSuccess: () => void;
  onClose: () => void;
  onError: (error: unknown) => void;
};

declare global {
  interface Window {
    SmileIdentity?: (options: SmileIdentityOptions) => void;
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("onboarding");
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiBaseUrl);
  const [draft, setDraft] = useState<Draft>({
    sendAmount: "100",
    recipientName: "Aline Mukamana",
    phoneNumber: "+250788000000",
    senderEmail: "you@example.com",
    senderPhoneNumber: "+15550000000"
  });
  const [flow, setFlow] = useState<FlowState>({
    user: null,
    beneficiary: null,
    quote: null,
    transfer: null
  });
  const [history, setHistory] = useState<ApiTransfer[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<ApiBeneficiary[]>([]);
  const [walletSummary, setWalletSummary] = useState<ApiWalletSummary>({ userId: "", balances: [] });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [otpChallenge, setOtpChallenge] = useState<ApiOtpChallenge | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [kycCase, setKycCase] = useState<ApiKycCase | null>(null);
  const [smileSession, setSmileSession] = useState<ApiSmileKycSession | null>(null);
  const [legalName, setLegalName] = useState("");
  const [documentType, setDocumentType] = useState<"national_id" | "passport" | "drivers_license">("national_id");

  useEffect(() => {
    let isMounted = true;

    async function restoreStoredSession() {
      try {
        const token = await AsyncStorage.getItem(sessionStorageKey);

        if (!token) {
          return;
        }

        const user = await restoreSession(defaultApiBaseUrl, token);
        const [savedBeneficiaries, wallet, kyc] = await Promise.all([
          listBeneficiaries(defaultApiBaseUrl, user.id),
          getWalletSummary(defaultApiBaseUrl, user.id),
          getKycStatus(defaultApiBaseUrl, user.id)
        ]);
        const transfers = await listTransfers(defaultApiBaseUrl, user.id);

        if (isMounted) {
          setFlow((current) => ({ ...current, user }));
          setBeneficiaries(savedBeneficiaries);
          setWalletSummary(wallet);
          setKycCase(kyc.kycCase);
          setHistory(transfers);
          setScreen(user.kycStatus === "approved" ? "home" : "kyc");
        }
      } catch {
        await AsyncStorage.removeItem(sessionStorageKey);
      } finally {
        if (isMounted) {
          setIsRestoringSession(false);
        }
      }
    }

    void restoreStoredSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const preview = useMemo(() => {
    const sourceMinor = dollarsToMinor(draft.sendAmount);
    const feeMinor = 99 + Math.floor(sourceMinor * 0.015);
    const destination = Math.round(((sourceMinor - feeMinor) / 100) * 1410.25);

    return {
      source: formatMoney(String(sourceMinor), "USD"),
      fee: formatMoney(String(feeMinor), "USD"),
      destination: formatMoney(String(destination), "RWF")
    };
  }, [draft.sendAmount]);

  function changeScreen(nextScreen: Screen) {
    setScreen(nextScreen);

    if (nextScreen === "history" && flow.user) {
      void refreshHistory(flow.user.id);
    }
  }

  async function refreshHistory(senderUserId: string) {
    try {
      const transfers = await listTransfers(apiBaseUrl.trim(), senderUserId);
      setHistory(transfers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load transfer history");
    }
  }

  async function refreshWalletSummary(userId: string) {
    try {
      setWalletSummary(await getWalletSummary(apiBaseUrl.trim(), userId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load wallet balance");
    }
  }

  async function refreshKycVerification(userId = flow.user?.id) {
    if (!userId) return;

    try {
      const kyc = await getKycStatus(apiBaseUrl.trim(), userId);
      setFlow((current) => ({ ...current, user: kyc.user }));
      setKycCase(kyc.kycCase);
      if (kyc.user.kycStatus === "approved") {
        setScreen("home");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not refresh verification status");
    }
  }

  async function prepareQuote() {
    setIsLoading(true);
    setError(null);

    try {
      const user =
        flow.user ??
        (await findUserByEmail(apiBaseUrl.trim(), draft.senderEmail)) ??
        (await createUser(apiBaseUrl.trim(), {
          email: draft.senderEmail,
          phoneNumber: `+1555${String(Date.now()).slice(-7)}`,
          countryCode: "US"
      }));
      const savedBeneficiaries = await listBeneficiaries(apiBaseUrl.trim(), user.id);
      const beneficiary =
        savedBeneficiaries.find(
          (item) => item.displayName.toLowerCase() === draft.recipientName.trim().toLowerCase()
        ) ??
        (await createBeneficiary(apiBaseUrl.trim(), {
          userId: user.id,
          displayName: draft.recipientName.trim(),
          countryCode: "RW",
          payoutMethod: "mobile_money",
          payoutToken: draft.phoneNumber.trim()
        }));
      const quote = await createQuote(apiBaseUrl.trim(), {
        senderUserId: user.id,
        sourceAmount: {
          amountMinor: String(dollarsToMinor(draft.sendAmount)),
          currency: "USD"
        },
        destinationCurrency: "RWF",
        exchangeRate: "1410.25",
        feeBasisPoints: 150,
        fixedFeeMinor: "99"
      });

      setBeneficiaries(
        savedBeneficiaries.some((item) => item.id === beneficiary.id)
          ? savedBeneficiaries
          : [beneficiary, ...savedBeneficiaries]
      );
      setFlow({ user, beneficiary, quote, transfer: null });
      setScreen("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare quote");
    } finally {
      setIsLoading(false);
    }
  }

  async function requestVerificationCode() {
    setIsLoading(true);
    setError(null);

    try {
      const challenge = await requestOtp(apiBaseUrl.trim(), {
        email: draft.senderEmail.trim(),
        phoneNumber: draft.senderPhoneNumber.trim(),
        countryCode: "US"
      });

      setOtpChallenge(challenge);
      setOtpCode(challenge.devCode ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send your verification code");
    } finally {
      setIsLoading(false);
    }
  }

  async function verifyVerificationCode() {
    if (!otpChallenge) {
      setError("Request a verification code first");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const session = await verifyOtp(apiBaseUrl.trim(), {
        challengeId: otpChallenge.challengeId,
        code: otpCode.trim()
      });
      await AsyncStorage.setItem(sessionStorageKey, session.token);
      const [savedBeneficiaries, wallet, transfers] = await Promise.all([
        listBeneficiaries(apiBaseUrl.trim(), session.user.id),
        getWalletSummary(apiBaseUrl.trim(), session.user.id),
        listTransfers(apiBaseUrl.trim(), session.user.id)
      ]);
      const kyc = await getKycStatus(apiBaseUrl.trim(), session.user.id);

      setFlow((current) => ({ ...current, user: session.user }));
      setBeneficiaries(savedBeneficiaries);
      setWalletSummary(wallet);
      setKycCase(kyc.kycCase);
      setHistory(transfers);
      setOtpChallenge(null);
      setOtpCode("");
      setScreen(session.user.kycStatus === "approved" ? "home" : "kyc");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not verify your code");
    } finally {
      setIsLoading(false);
    }
  }

  async function submitKycVerification() {
    if (!flow.user) {
      setError("Your session is not ready");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await submitKyc(apiBaseUrl.trim(), flow.user.id, { legalName: legalName.trim(), documentType });
      setFlow((current) => ({ ...current, user: result.user }));
      setKycCase(result.kycCase);
      setScreen("home");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit verification");
    } finally {
      setIsLoading(false);
    }
  }

  async function launchSmileKycVerification() {
    if (!flow.user) {
      setError("Your session is not ready");
      return;
    }

    if (Platform.OS !== "web") {
      setError("Smile hosted verification is available in the web build first. Use manual review on this device.");
      return;
    }

    if (!legalName.trim()) {
      setError("Enter your legal name before starting Smile ID");
      return;
    }

    if (!smilePartnerId || !smileCallbackUrl || !smilePolicyUrl || !smileLogoUrl) {
      setError("Smile public config is missing. Set EXPO_PUBLIC_SMILE_PARTNER_ID, CALLBACK_URL, POLICY_URL, and LOGO_URL.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await createSmileKycSession(apiBaseUrl.trim(), flow.user.id, {
        legalName: legalName.trim(),
        documentType
      });

      setFlow((current) => ({ ...current, user: result.user }));
      setKycCase(result.kycCase);

      if (!result.smile) {
        await refreshKycVerification(flow.user.id);
        return;
      }

      setSmileSession(result.smile);
      await loadSmileWidgetScript();

      if (!window.SmileIdentity) {
        throw new Error("Smile ID widget did not load");
      }

      window.SmileIdentity({
        token: result.smile.token,
        product: "doc_verification",
        callback_url: smileCallbackUrl,
        environment: smileEnvironment,
        partner_details: {
          partner_id: smilePartnerId,
          name: "Velo",
          logo_url: smileLogoUrl,
          policy_url: smilePolicyUrl,
          theme_color: colors.secondary
        },
        partner_params: {
          user_id: result.smile.userId,
          job_id: result.smile.jobId
        },
        onSuccess: () => {
          void refreshKycVerification(flow.user?.id);
        },
        onClose: () => {
          void refreshKycVerification(flow.user?.id);
        },
        onError: (caught) => {
          setError(caught instanceof Error ? caught.message : "Smile ID could not start verification");
        }
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start Smile ID verification");
    } finally {
      setIsLoading(false);
    }
  }

  async function confirmTransfer() {
    if (!flow.user || !flow.beneficiary || !flow.quote) {
      setError("Quote is not ready");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const transfer = await createTransfer(apiBaseUrl.trim(), {
        senderUserId: flow.user.id,
        beneficiaryId: flow.beneficiary.id,
        quoteId: flow.quote.id,
        paymentMethod: "card",
        payoutMethod: "mobile_money"
      });
      const paidTransfer = await markPaymentReceived(apiBaseUrl.trim(), transfer.id);

      setFlow((current) => ({ ...current, transfer: paidTransfer }));
      await refreshWalletSummary(flow.user.id);
      await refreshHistory(flow.user.id);
      setScreen("status");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not confirm transfer");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <AppShell>
          <TopBar />
          {isRestoringSession ? <SessionLoading /> : null}
          {!isRestoringSession && screen !== "onboarding" ? <Tabs screen={screen} onChange={changeScreen} /> : null}

          {!isRestoringSession && screen === "onboarding" ? (
            <OnboardingScreen
              apiBaseUrl={apiBaseUrl}
              draft={draft}
              error={error}
              isLoading={isLoading}
              otpChallenge={otpChallenge}
              otpCode={otpCode}
              onApiBaseUrlChange={setApiBaseUrl}
              onChange={setDraft}
              onOtpCodeChange={setOtpCode}
              onRequestCode={requestVerificationCode}
              onVerifyCode={verifyVerificationCode}
            />
          ) : null}

          {!isRestoringSession && screen === "home" ? (
            <HomeScreen
              latestTransfer={history[0] ?? null}
              onSend={() => changeScreen(flow.user?.kycStatus === "approved" ? "send" : "kyc")}
              onVerify={() => changeScreen("kyc")}
              kycStatus={flow.user?.kycStatus ?? "not_started"}
              walletSummary={walletSummary}
            />
          ) : null}

          {!isRestoringSession && screen === "kyc" ? (
            <KycScreen
              caseRecord={kycCase}
              error={error}
              isLoading={isLoading}
              legalName={legalName}
              documentType={documentType}
              onBack={() => changeScreen("home")}
              onDocumentTypeChange={setDocumentType}
              onLegalNameChange={setLegalName}
              onRefresh={() => void refreshKycVerification()}
              onSmileSubmit={launchSmileKycVerification}
              onSubmit={submitKycVerification}
              smileSession={smileSession}
            />
          ) : null}

          {!isRestoringSession && screen === "send" ? (
            <SendScreen
              apiBaseUrl={apiBaseUrl}
              draft={draft}
              error={error}
              isLoading={isLoading}
              onApiBaseUrlChange={setApiBaseUrl}
              onChange={setDraft}
              onContinue={prepareQuote}
              onSelectRecipient={(beneficiary) =>
                setDraft((current) => ({ ...current, recipientName: beneficiary.displayName }))
              }
              preview={preview}
              beneficiaries={beneficiaries}
            />
          ) : null}

          {!isRestoringSession && screen === "review" ? (
            <ReviewScreen
              beneficiary={flow.beneficiary}
              error={error}
              isLoading={isLoading}
              onBack={() => changeScreen("send")}
              onConfirm={confirmTransfer}
              quote={flow.quote}
            />
          ) : null}

          {!isRestoringSession && screen === "status" ? (
            <StatusScreen beneficiary={flow.beneficiary} onNewTransfer={() => changeScreen("send")} transfer={flow.transfer} />
          ) : null}

          {!isRestoringSession && screen === "history" ? <HistoryScreen onSend={() => changeScreen("send")} transfers={history} /> : null}
        </AppShell>
      </ScrollView>
    </SafeAreaView>
  );
}

function TopBar() {
  return (
    <View style={styles.topBar}>
      <View style={styles.brandLockup}>
        <View style={styles.logoMark}>
          <Text style={styles.logoLetter}>V</Text>
          <View style={styles.logoSpark} />
        </View>
        <View>
          <Text style={styles.brand}>Velo</Text>
          <Text style={styles.brandMuted}>Move money freely</Text>
        </View>
      </View>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>VL</Text>
      </View>
    </View>
  );
}

function SessionLoading() {
  return (
    <View style={styles.sessionLoading}>
      <View style={styles.sessionLoadingMark}>
        <Text style={styles.logoLetter}>V</Text>
      </View>
      <Text style={styles.sessionLoadingTitle}>Restoring your Velo wallet</Text>
      <Text style={styles.sessionLoadingCopy}>Checking your secure session and latest balance.</Text>
    </View>
  );
}

function OnboardingScreen({
  apiBaseUrl,
  draft,
  error,
  isLoading,
  otpChallenge,
  otpCode,
  onApiBaseUrlChange,
  onChange,
  onOtpCodeChange,
  onRequestCode,
  onVerifyCode
}: {
  apiBaseUrl: string;
  draft: Draft;
  error: string | null;
  isLoading: boolean;
  otpChallenge: ApiOtpChallenge | null;
  otpCode: string;
  onApiBaseUrlChange: (value: string) => void;
  onChange: (draft: Draft) => void;
  onOtpCodeChange: (value: string) => void;
  onRequestCode: () => void;
  onVerifyCode: () => void;
}) {
  return (
    <>
      <View style={styles.onboardingIntro}>
        <View style={styles.onboardingEyebrow}>
          <View style={styles.eyebrowDot} />
          <Text style={styles.eyebrowText}>A calmer way to move money</Text>
        </View>
        <Text style={styles.onboardingTitle}>Your world is bigger than one border.</Text>
        <Text style={styles.onboardingCopy}>
          Create your Velo wallet and send money to the people who matter, with clear rates and no unnecessary friction.
        </Text>
      </View>

      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{otpChallenge ? "Verify your number" : "Create your wallet"}</Text>
          <Text style={styles.sectionBadge}>{otpChallenge ? "Step 2 of 2" : "Step 1 of 2"}</Text>
        </View>
        <LabeledInput
          keyboardType="email-address"
          label="Email address"
          onChangeText={(senderEmail) => onChange({ ...draft, senderEmail })}
          value={draft.senderEmail}
        />
        <LabeledInput
          keyboardType="phone-pad"
          label="Mobile number"
          onChangeText={(senderPhoneNumber) => onChange({ ...draft, senderPhoneNumber })}
          value={draft.senderPhoneNumber}
        />
        {otpChallenge ? (
          <>
            <LabeledInput
              keyboardType="numeric"
              label="Verification code"
              onChangeText={onOtpCodeChange}
              value={otpCode}
            />
            {otpChallenge.devCode ? (
              <View style={styles.devCodePanel}>
                <Text style={styles.devCodeLabel}>Local development code</Text>
                <Text style={styles.devCode}>{otpChallenge.devCode}</Text>
              </View>
            ) : null}
          </>
        ) : null}
        <View style={styles.trustRow}>
          <View style={styles.trustIcon}>
            <Text style={styles.trustIconText}>OK</Text>
          </View>
          <View style={styles.trustCopy}>
            <Text style={styles.trustTitle}>Built around your control</Text>
            <Text style={styles.trustText}>Your wallet identity stays connected to every transfer and receipt.</Text>
          </View>
        </View>
        <PrimaryButton
          label={otpChallenge ? "Verify and open wallet" : "Send verification code"}
          loading={isLoading}
          onPress={otpChallenge ? onVerifyCode : onRequestCode}
        />
      </Card>

      {error ? <ErrorPanel message={error} /> : null}

      <Card>
        <Text style={styles.settingsLabel}>API base URL</Text>
        <LabeledInput label="Local backend" onChangeText={onApiBaseUrlChange} value={apiBaseUrl} />
      </Card>
    </>
  );
}

function Tabs({ screen, onChange }: { screen: Screen; onChange: (screen: Screen) => void }) {
  return (
    <View style={styles.tabs}>
      <TouchableOpacity onPress={() => onChange("home")} style={styles.tabButton}>
        <Pill active={screen === "home"} label="Home" />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onChange("send")} style={styles.tabButton}>
        <Pill active={screen === "send" || screen === "review" || screen === "status"} label="Send" />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onChange("history")} style={styles.tabButton}>
        <Pill active={screen === "history"} label="History" />
      </TouchableOpacity>
    </View>
  );
}

function HomeScreen({
  latestTransfer,
  onSend,
  onVerify,
  kycStatus,
  walletSummary
}: {
  latestTransfer: ApiTransfer | null;
  onSend: () => void;
  onVerify: () => void;
  kycStatus: string;
  walletSummary: ApiWalletSummary;
}) {
  const usdBalance = walletSummary.balances.find((balance) => balance.currency === "USD");

  return (
    <>
      <Card tone="dark">
        <View style={styles.heroTopRow}>
          <Text style={styles.heroLabel}>VELO WALLET</Text>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
        </View>
        <Text style={styles.balance}>{formatMoney(usdBalance?.amountMinor ?? "0", "USD")}</Text>
        <Text style={styles.heroHeadline}>Your money, moving with you.</Text>
        <View style={styles.heroDivider} />
        <View style={styles.balanceMetaRow}>
          <Text style={styles.balanceMeta}>USD wallet</Text>
          <Text style={styles.balanceMeta}>1 USD = 1,410.25 RWF</Text>
        </View>
        <Text style={styles.heroFooter}>Fast, transparent transfers for every next move.</Text>
      </Card>

      <View style={styles.quickActions}>
        <Pill active label="Send" />
        <Pill label="Deposit" />
        <Pill label="Cards" />
      </View>

      {kycStatus === "approved" ? (
        <View style={styles.verifiedStrip}>
          <View style={styles.verifiedDot} />
          <Text style={styles.verifiedText}>Identity verified. Your Velo wallet is ready.</Text>
        </View>
      ) : (
        <Card>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Verify your identity</Text>
            <Text style={styles.sectionBadge}>{kycStatus.replaceAll("_", " ")}</Text>
          </View>
          <Text style={styles.emptyText}>Complete a quick identity review before sending money.</Text>
          <PrimaryButton label="Continue verification" onPress={onVerify} />
        </Card>
      )}

      <Card>
        <Text style={styles.sectionTitle}>Next transfer</Text>
        <View style={styles.routeRow}>
          <CountryBlock code="US" label="United States" />
          <View style={styles.routeLine} />
          <CountryBlock code="RW" label="Rwanda" />
        </View>
        <View style={styles.detailGrid}>
          <Metric label="Delivery" value="Mobile money" />
          <Metric label="Fee from" value="$0.99" />
        </View>
        <PrimaryButton label="Start transfer" onPress={onSend} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Latest activity</Text>
        {latestTransfer ? (
          <>
            <Row label="Transfer" value={latestTransfer.id} />
            <Row label="Status" value={latestTransfer.status.replaceAll("_", " ")} />
          </>
        ) : (
          <Text style={styles.emptyText}>Completed demo transfers will appear here.</Text>
        )}
      </Card>
    </>
  );
}

function KycScreen({
  caseRecord,
  documentType,
  error,
  isLoading,
  legalName,
  onBack,
  onDocumentTypeChange,
  onLegalNameChange,
  onRefresh,
  onSmileSubmit,
  smileSession,
  onSubmit
}: {
  caseRecord: ApiKycCase | null;
  documentType: "national_id" | "passport" | "drivers_license";
  error: string | null;
  isLoading: boolean;
  legalName: string;
  onBack: () => void;
  onDocumentTypeChange: (value: "national_id" | "passport" | "drivers_license") => void;
  onLegalNameChange: (value: string) => void;
  onRefresh: () => void;
  onSmileSubmit: () => void;
  smileSession: ApiSmileKycSession | null;
  onSubmit: () => void;
}) {
  if (caseRecord?.status === "pending") {
    return (
      <Card>
        <View style={styles.kycStatusIcon}>
          <Text style={styles.kycStatusMark}>...</Text>
        </View>
        <Text style={styles.statusTitle}>Verification in review</Text>
        <Text style={styles.statusCopy}>We have your details. The Velo compliance team will review them before transfers are enabled.</Text>
        <Row label="Status" value="Pending review" />
        {caseRecord.provider === "smile" ? <Row label="Provider" value="Smile ID" /> : null}
        {caseRecord.providerCaseId ? <Row label="Reference" value={caseRecord.providerCaseId} /> : null}
        <PrimaryButton label={isLoading ? "Refreshing..." : "Refresh status"} loading={isLoading} onPress={onRefresh} />
        <GhostButton label="Back to wallet" onPress={onBack} />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Verify your identity</Text>
          <Text style={styles.sectionBadge}>Secure</Text>
        </View>
        <Text style={styles.kycIntro}>Use your legal name and choose the document you will provide for review.</Text>
        <LabeledInput label="Legal name" onChangeText={onLegalNameChange} value={legalName} />
        <Text style={styles.inputLabel}>Document type</Text>
        <View style={styles.documentChoices}>
          <TouchableOpacity onPress={() => onDocumentTypeChange("national_id")}>
            <Pill active={documentType === "national_id"} label="National ID" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDocumentTypeChange("passport")}>
            <Pill active={documentType === "passport"} label="Passport" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDocumentTypeChange("drivers_license")}>
            <Pill active={documentType === "drivers_license"} label="Driver license" />
          </TouchableOpacity>
        </View>
        {Platform.OS === "web" ? (
          <View style={styles.kycProviderPanel}>
            <Text style={styles.kycProviderTitle}>Smile ID</Text>
            <Text style={styles.kycProviderCopy}>Fast document verification opens in a secure hosted check.</Text>
            {smileSession ? <Row label="Session" value={smileSession.jobId} /> : null}
          </View>
        ) : null}
        {Platform.OS === "web" ? (
          <PrimaryButton label="Verify with Smile ID" loading={isLoading} onPress={onSmileSubmit} />
        ) : null}
        <GhostButton label="Submit for manual review" onPress={onSubmit} />
        <GhostButton label="Back to wallet" onPress={onBack} />
      </Card>
      {error ? <ErrorPanel message={error} /> : null}
    </>
  );
}

function SendScreen({
  apiBaseUrl,
  beneficiaries,
  draft,
  error,
  isLoading,
  onApiBaseUrlChange,
  onChange,
  onContinue,
  onSelectRecipient,
  preview
}: {
  apiBaseUrl: string;
  beneficiaries: ApiBeneficiary[];
  draft: Draft;
  error: string | null;
  isLoading: boolean;
  onApiBaseUrlChange: (value: string) => void;
  onChange: (draft: Draft) => void;
  onContinue: () => void;
  onSelectRecipient: (beneficiary: ApiBeneficiary) => void;
  preview: { source: string; fee: string; destination: string };
}) {
  return (
    <>
      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Send to Rwanda</Text>
          <Text style={styles.sectionBadge}>Quote</Text>
        </View>
        <LabeledInput keyboardType="numeric" label="You send" onChangeText={(sendAmount) => onChange({ ...draft, sendAmount })} value={draft.sendAmount} />
        <LabeledInput label="Recipient" onChangeText={(recipientName) => onChange({ ...draft, recipientName })} value={draft.recipientName} />
        {beneficiaries.length > 0 ? (
          <View style={styles.savedRecipients}>
            <Text style={styles.savedRecipientLabel}>Saved recipients</Text>
            <View style={styles.recipientChoices}>
              {beneficiaries.map((beneficiary) => (
                <TouchableOpacity key={beneficiary.id} onPress={() => onSelectRecipient(beneficiary)}>
                  <Pill active={beneficiary.displayName === draft.recipientName} label={beneficiary.displayName} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}
        <LabeledInput keyboardType="phone-pad" label="Mobile money phone" onChangeText={(phoneNumber) => onChange({ ...draft, phoneNumber })} value={draft.phoneNumber} />
        <View style={styles.detailGrid}>
          <Metric label="Fee" value={preview.fee} />
          <Metric label="Recipient gets" value={preview.destination} />
        </View>
        <PrimaryButton label="Review transfer" loading={isLoading} onPress={onContinue} />
      </Card>

      {error ? <ErrorPanel message={error} /> : null}

      <Card>
        <Text style={styles.settingsLabel}>API base URL</Text>
        <LabeledInput label="Local backend" onChangeText={onApiBaseUrlChange} value={apiBaseUrl} />
      </Card>
    </>
  );
}

function ReviewScreen({
  beneficiary,
  error,
  isLoading,
  onBack,
  onConfirm,
  quote
}: {
  beneficiary: ApiBeneficiary | null;
  error: string | null;
  isLoading: boolean;
  onBack: () => void;
  onConfirm: () => void;
  quote: ApiQuote | null;
}) {
  if (!quote || !beneficiary) {
    return (
      <Card>
        <Text style={styles.sectionTitle}>Quote expired</Text>
        <GhostButton label="Return to send" onPress={onBack} />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Review transfer</Text>
          <Text style={styles.sectionBadge}>15 min</Text>
        </View>
        <View style={styles.amountPanel}>
          <Text style={styles.amountLabel}>You send</Text>
          <Text style={styles.amountValue}>{formatMoney(quote.sourceAmount.amountMinor, quote.sourceAmount.currency)}</Text>
        </View>
        <View style={styles.rateRow}>
          <View style={styles.rateLine} />
          <View style={styles.rateBubble}>
            <Text style={styles.rateText}>FX</Text>
          </View>
          <View style={styles.rateLine} />
        </View>
        <View style={styles.amountPanelGreen}>
          <Text style={styles.amountLabelGreen}>Recipient gets</Text>
          <Text style={styles.amountValueGreen}>{formatMoney(quote.destinationAmount.amountMinor, quote.destinationAmount.currency)}</Text>
        </View>
        <View style={styles.recipientRow}>
          <View style={styles.recipientIcon}>
            <Text style={styles.recipientInitial}>{beneficiary.displayName.slice(0, 1)}</Text>
          </View>
          <View style={styles.recipientText}>
            <Text style={styles.recipientName}>{beneficiary.displayName}</Text>
            <Text style={styles.recipientMeta}>MTN Mobile Money - Rwanda</Text>
          </View>
        </View>
        <View style={styles.detailGrid}>
          <Metric label="Fee" value={formatMoney(quote.feeAmount.amountMinor, quote.feeAmount.currency)} />
          <Metric label="Rate" value={quote.exchangeRate} />
        </View>
        <PrimaryButton label="Confirm and send" loading={isLoading} onPress={onConfirm} />
        <GhostButton label="Edit details" onPress={onBack} />
      </Card>
      {error ? <ErrorPanel message={error} /> : null}
    </>
  );
}

function StatusScreen({
  beneficiary,
  onNewTransfer,
  transfer
}: {
  beneficiary: ApiBeneficiary | null;
  onNewTransfer: () => void;
  transfer: ApiTransfer | null;
}) {
  return (
    <Card>
      <View style={styles.successIcon}>
        <Text style={styles.successMark}>OK</Text>
      </View>
      <Text style={styles.statusTitle}>Transfer submitted</Text>
      <Text style={styles.statusCopy}>
        {beneficiary?.displayName ?? "Recipient"} will receive the payout after provider processing.
      </Text>
      {transfer ? (
        <>
          <Row label="Status" value={transfer.status.replaceAll("_", " ")} />
          <Row label="Recipient gets" value={formatMoney(transfer.destinationAmount.amountMinor, transfer.destinationAmount.currency)} />
          <Row label="Reference" value={transfer.id} />
        </>
      ) : null}
      <PrimaryButton label="New transfer" onPress={onNewTransfer} />
    </Card>
  );
}

function HistoryScreen({ transfers, onSend }: { transfers: ApiTransfer[]; onSend: () => void }) {
  return (
    <Card>
      <Text style={styles.sectionTitle}>Transfer history</Text>
      {transfers.length === 0 ? (
        <>
          <Text style={styles.emptyText}>No transfers yet. Start a live demo transfer to populate history.</Text>
          <PrimaryButton label="Send money" onPress={onSend} />
        </>
      ) : (
        transfers.map((transfer) => (
          <View key={transfer.id} style={styles.historyItem}>
            <View style={styles.historyText}>
              <Text style={styles.historyAmount}>{formatMoney(transfer.destinationAmount.amountMinor, transfer.destinationAmount.currency)}</Text>
              <Text style={styles.historyId}>{transfer.id}</Text>
            </View>
            <Text style={styles.historyStatus}>{transfer.status.replaceAll("_", " ")}</Text>
          </View>
        ))
      )}
    </Card>
  );
}

function CountryBlock({ code, label }: { code: string; label: string }) {
  return (
    <View style={styles.countryBlock}>
      <Text style={styles.countryCode}>{code}</Text>
      <Text style={styles.countryLabel}>{label}</Text>
    </View>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <View style={styles.errorPanel}>
      <Text style={styles.errorTitle}>Unable to continue</Text>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function dollarsToMinor(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
}

function formatMoney(amountMinor: string, currency: string): string {
  const exponent = currency === "RWF" || currency === "UGX" || currency === "TZS" ? 0 : 2;
  const amount = Number(amountMinor) / 10 ** exponent;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: exponent
  }).format(amount);
}

async function loadSmileWidgetScript(): Promise<void> {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    throw new Error("Smile ID hosted verification requires the web build");
  }

  if (window.SmileIdentity) {
    return;
  }

  const existingScript = document.getElementById("smile-identity-widget");
  if (existingScript) {
    await new Promise<void>((resolve, reject) => {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Smile ID widget script failed to load")), {
        once: true
      });
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "smile-identity-widget";
    script.async = true;
    script.src = smileWidgetScriptUrl;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Smile ID widget script failed to load")), { once: true });
    document.head.appendChild(script);
  });
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  },
  scrollContent: {
    paddingBottom: 32
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10
  },
  brandLockup: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  logoMark: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 15,
    height: 44,
    justifyContent: "center",
    position: "relative",
    width: 44
  },
  logoLetter: {
    color: colors.white,
    fontSize: 23,
    fontWeight: "900",
    letterSpacing: 0
  },
  logoSpark: {
    backgroundColor: colors.secondaryBright,
    borderRadius: radius.full,
    bottom: 8,
    height: 7,
    position: "absolute",
    right: 8,
    width: 7
  },
  brand: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: "900"
  },
  brandMuted: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700"
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.full,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  avatarText: {
    color: colors.primaryContainer,
    fontSize: 13,
    fontWeight: "900"
  },
  sessionLoading: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 64
  },
  sessionLoadingMark: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 18,
    height: 58,
    justifyContent: "center",
    marginBottom: 8,
    width: 58
  },
  sessionLoadingTitle: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center"
  },
  sessionLoadingCopy: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center"
  },
  onboardingIntro: {
    gap: 12,
    paddingBottom: 4,
    paddingTop: 12
  },
  onboardingEyebrow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  eyebrowDot: {
    backgroundColor: colors.secondaryBright,
    borderRadius: radius.full,
    height: 8,
    width: 8
  },
  eyebrowText: {
    color: colors.secondary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4
  },
  onboardingTitle: {
    color: colors.primary,
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 40
  },
  onboardingCopy: {
    color: colors.mutedStrong,
    fontSize: 16,
    lineHeight: 24
  },
  trustRow: {
    alignItems: "center",
    backgroundColor: colors.secondarySoft,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: 12,
    padding: 13
  },
  trustIcon: {
    alignItems: "center",
    backgroundColor: colors.secondary,
    borderRadius: radius.full,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  trustIconText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: "900"
  },
  trustCopy: {
    flex: 1,
    gap: 3
  },
  trustTitle: {
    color: colors.secondary,
    fontSize: 13,
    fontWeight: "900"
  },
  trustText: {
    color: colors.mutedStrong,
    fontSize: 12,
    lineHeight: 17
  },
  devCodePanel: {
    alignItems: "center",
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    gap: 4,
    padding: 12
  },
  devCodeLabel: {
    color: colors.primaryContainer,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  devCode: {
    color: colors.primary,
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: 4
  },
  tabs: {
    flexDirection: "row",
    gap: 10
  },
  tabButton: {
    flex: 1
  },
  heroTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  heroLabel: {
    color: "#aac7fd",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2
  },
  livePill: {
    alignItems: "center",
    backgroundColor: "rgba(107, 254, 156, 0.16)",
    borderRadius: radius.full,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  liveDot: {
    backgroundColor: "#6bfe9c",
    borderRadius: radius.full,
    height: 7,
    width: 7
  },
  liveText: {
    color: "#6bfe9c",
    fontSize: 12,
    fontWeight: "800"
  },
  balance: {
    color: colors.white,
    fontSize: 40,
    fontWeight: "900",
    lineHeight: 48,
    marginTop: 22
  },
  heroHeadline: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2
  },
  heroDivider: {
    backgroundColor: "rgba(214, 227, 255, 0.24)",
    height: 1,
    marginTop: 20
  },
  balanceMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    marginTop: 18
  },
  balanceMeta: {
    color: "#d6e3ff",
    fontSize: 13,
    fontWeight: "700"
  },
  heroFooter: {
    color: "#aac7fd",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 16
  },
  quickActions: {
    flexDirection: "row",
    gap: 10
  },
  verifiedStrip: {
    alignItems: "center",
    backgroundColor: colors.secondarySoft,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: 9,
    padding: 13
  },
  verifiedDot: {
    backgroundColor: colors.secondaryBright,
    borderRadius: radius.full,
    height: 9,
    width: 9
  },
  verifiedText: {
    color: colors.secondary,
    flex: 1,
    fontSize: 12,
    fontWeight: "900"
  },
  kycIntro: {
    color: colors.mutedStrong,
    fontSize: 14,
    lineHeight: 21
  },
  kycProviderPanel: {
    backgroundColor: colors.secondarySoft,
    borderColor: "rgba(0, 109, 55, 0.18)",
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 6,
    padding: 14
  },
  kycProviderTitle: {
    color: colors.secondary,
    fontSize: 15,
    fontWeight: "900"
  },
  kycProviderCopy: {
    color: colors.mutedStrong,
    fontSize: 13,
    lineHeight: 19
  },
  inputLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  documentChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  kycStatusIcon: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.primarySoft,
    borderRadius: radius.full,
    height: 64,
    justifyContent: "center",
    width: 64
  },
  kycStatusMark: {
    color: colors.primaryContainer,
    fontSize: 20,
    fontWeight: "900"
  },
  savedRecipients: {
    gap: 8
  },
  recipientChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  savedRecipientLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  sectionTitle: {
    color: colors.primary,
    fontSize: 21,
    fontWeight: "900"
  },
  sectionBadge: {
    backgroundColor: colors.secondarySoft,
    borderRadius: radius.full,
    color: colors.secondary,
    fontSize: 12,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    textTransform: "capitalize"
  },
  routeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  routeLine: {
    backgroundColor: colors.outline,
    flex: 1,
    height: 2
  },
  countryBlock: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: radius.md,
    minWidth: 102,
    padding: 14
  },
  countryCode: {
    color: colors.primaryContainer,
    fontSize: 18,
    fontWeight: "900"
  },
  countryLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
    textAlign: "center"
  },
  detailGrid: {
    flexDirection: "row",
    gap: 12
  },
  amountPanel: {
    backgroundColor: colors.surfaceLow,
    borderRadius: radius.md,
    padding: 16
  },
  amountPanelGreen: {
    backgroundColor: colors.secondarySoft,
    borderRadius: radius.md,
    padding: 16
  },
  amountLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  amountLabelGreen: {
    color: colors.secondary,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  amountValue: {
    color: colors.primary,
    fontSize: 30,
    fontWeight: "900",
    marginTop: 6
  },
  amountValueGreen: {
    color: colors.secondary,
    fontSize: 30,
    fontWeight: "900",
    marginTop: 6
  },
  rateRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  rateLine: {
    backgroundColor: colors.outline,
    flex: 1,
    height: 1
  },
  rateBubble: {
    alignItems: "center",
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.full,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  rateText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: "900"
  },
  recipientRow: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: 12,
    padding: 12
  },
  recipientIcon: {
    alignItems: "center",
    backgroundColor: colors.primarySoft,
    borderRadius: radius.full,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  recipientInitial: {
    color: colors.primaryContainer,
    fontSize: 18,
    fontWeight: "900"
  },
  recipientText: {
    flex: 1
  },
  recipientName: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "900"
  },
  recipientMeta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 3
  },
  successIcon: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.secondary,
    borderRadius: radius.full,
    height: 72,
    justifyContent: "center",
    width: 72
  },
  successMark: {
    color: colors.white,
    fontSize: 18,
    fontWeight: "900"
  },
  statusTitle: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center"
  },
  statusCopy: {
    color: colors.mutedStrong,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center"
  },
  historyItem: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: radius.md,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14
  },
  historyText: {
    flex: 1,
    paddingRight: 10
  },
  historyAmount: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "900"
  },
  historyId: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4
  },
  historyStatus: {
    color: colors.secondary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "capitalize"
  },
  settingsLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  emptyText: {
    color: colors.mutedStrong,
    fontSize: 15,
    lineHeight: 22
  },
  errorPanel: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: 16
  },
  errorTitle: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: "900"
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    marginTop: 4
  }
});
