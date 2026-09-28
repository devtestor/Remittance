import { StrictMode, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Check,
  CircleDollarSign,
  Clock3,
  FileText,
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
  Split,
  Users,
  UserCheck,
  X
} from "lucide-react";
import "./styles.css";

type KycStatus = "not_started" | "pending" | "approved" | "rejected" | "expired";

type User = {
  id: string;
  email: string;
  phoneNumber?: string;
  countryCode: string;
  kycStatus: KycStatus;
  createdAt: string;
};

type KycCase = {
  id: string;
  userId: string;
  status: KycStatus;
  legalName?: string;
  documentType?: string;
  provider?: string;
  providerCaseId?: string;
  submittedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  user: User;
};

type TimelineEvent = {
  id: string;
  label: string;
  detail?: string;
  actorType?: string;
  createdAt: string;
};

type Transfer = {
  id: string;
  status: string;
  sourceAmount: Money;
  destinationAmount: Money;
  feeAmount: Money;
  paymentMethod: string;
  payoutMethod: string;
  createdAt: string;
  sender: Pick<User, "id" | "email" | "countryCode" | "kycStatus">;
  beneficiary: {
    id: string;
    displayName: string;
    countryCode: string;
    payoutMethod: string;
  };
};

type LedgerTransaction = {
  id: string;
  idempotencyKey: string;
  memo: string;
  postedAt: string;
  entries: Array<{
    id: string;
    accountId: string;
    side: "debit" | "credit";
    amountMinor: string;
    currency: string;
    memo: string;
    createdAt: string;
  }>;
};

type ProviderEvent = {
  id: string;
  provider: string;
  eventType: string;
  providerEventId?: string;
  idempotencyKey: string;
  status: string;
  receivedAt: string;
  processedAt?: string;
  errorMessage?: string;
};

type KycCaseDetail = KycCase & {
  timeline: TimelineEvent[];
  recentTransfers: Transfer[];
};

type TransferDetail = Transfer & {
  timeline: TimelineEvent[];
  ledgerTransactions: LedgerTransaction[];
  providerEvents: ProviderEvent[];
};

type RiskItem = {
  id: string;
  entityType: "kyc_case" | "transfer";
  entityId: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  status: string;
  createdAt: string;
};

type AuditLog = {
  id: string;
  actorType: string;
  actorEmail?: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
};

type AdminUser = {
  id: string;
  email: string;
  role: "admin" | "compliance";
  disabledAt?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  mfaEnabled?: boolean;
};

type Money = {
  amountMinor: string;
  currency: string;
};

const defaultApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const adminTokenStorageKey = "velo.admin.session.token";
type AdminTab = "compliance" | "transfers" | "risk" | "audit" | "team";

function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiBaseUrl);
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(adminTokenStorageKey) ?? "");
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [loginEmail, setLoginEmail] = useState("admin@velo.local");
  const [loginPassword, setLoginPassword] = useState("velo-admin-dev");
  const [loginMfaCode, setLoginMfaCode] = useState("");
  const [statusFilter, setStatusFilter] = useState<KycStatus | "all">("pending");
  const [cases, setCases] = useState<KycCase[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [riskItems, setRiskItems] = useState<RiskItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [teamEmail, setTeamEmail] = useState("");
  const [teamRole, setTeamRole] = useState<AdminUser["role"]>("compliance");
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [mfaSetupSecret, setMfaSetupSecret] = useState<string | null>(null);
  const [mfaSetupUri, setMfaSetupUri] = useState<string | null>(null);
  const [mfaSetupCode, setMfaSetupCode] = useState("");
  const [activeTab, setActiveTab] = useState<AdminTab>("compliance");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeciding, setIsDeciding] = useState<string | null>(null);
  const [isIntervening, setIsIntervening] = useState(false);
  const [selectedKycCase, setSelectedKycCase] = useState<KycCaseDetail | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<TransferDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const filteredCases = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cases;

    return cases.filter((item) =>
      [item.legalName, item.user.email, item.user.phoneNumber, item.documentType, item.provider, item.providerCaseId]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle))
    );
  }, [cases, query]);

  const metrics = useMemo(() => {
    const pending = cases.filter((item) => item.status === "pending").length;
    const approved = cases.filter((item) => item.status === "approved").length;
    const rejected = cases.filter((item) => item.status === "rejected").length;
    const volumeMinor = transfers.reduce((sum, transfer) => sum + Number.parseInt(transfer.sourceAmount.amountMinor, 10), 0);
    const highRisk = riskItems.filter((item) => item.severity === "high").length;

    return {
      pending,
      approved,
      rejected,
      highRisk,
      volume: formatMoney({ amountMinor: String(volumeMinor), currency: "USD" })
    };
  }, [cases, riskItems, transfers]);

  useEffect(() => {
    if (adminToken) {
      localStorage.setItem(adminTokenStorageKey, adminToken);
      return;
    }

    localStorage.removeItem(adminTokenStorageKey);
  }, [adminToken]);

  useEffect(() => {
    if (adminToken) {
      void restoreAdmin();
    }
  }, []);

  useEffect(() => {
    if (adminUser) {
      void refresh();
    }
  }, [statusFilter, adminUser]);

  async function login() {
    setIsLoading(true);
    setError(null);

    try {
      const payload = await publicApi<{ token: string; adminUser: AdminUser }>(apiBaseUrl, "/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
          ...(loginMfaCode ? { mfaCode: loginMfaCode } : {})
        })
      });

      setAdminToken(payload.token);
      setAdminUser(payload.adminUser);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in");
    } finally {
      setIsLoading(false);
    }
  }

  async function restoreAdmin() {
    setIsLoading(true);
    setError(null);

    try {
      const payload = await api<{ adminUser: AdminUser }>(apiBaseUrl, "/admin/auth/me", adminToken);
      setAdminUser(payload.adminUser);
    } catch (_caught) {
      setAdminToken("");
      setAdminUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  function logout() {
    setAdminToken("");
    setAdminUser(null);
    setCases([]);
    setTransfers([]);
    setRiskItems([]);
    setAuditLogs([]);
    setAdminUsers([]);
    setTemporaryPassword(null);
    closeDetail();
  }

  async function refresh() {
    if (!adminToken) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [kycPayload, transferPayload, riskPayload, auditPayload, teamPayload] = await Promise.all([
        api<{ cases: KycCase[] }>(
          apiBaseUrl,
          `/admin/kyc-cases${statusFilter === "all" ? "" : `?status=${statusFilter}`}`,
          adminToken
        ),
        api<{ transfers: Transfer[] }>(apiBaseUrl, "/admin/transfers", adminToken),
        api<{ items: RiskItem[] }>(apiBaseUrl, "/admin/risk-queue", adminToken),
        api<{ logs: AuditLog[] }>(
          apiBaseUrl,
          `/admin/audit-logs${auditQuery.trim() ? `?query=${encodeURIComponent(auditQuery.trim())}` : ""}`,
          adminToken
        ),
        adminUser?.role === "admin"
          ? api<{ users: AdminUser[] }>(apiBaseUrl, "/admin/users", adminToken)
          : Promise.resolve({ users: [] })
      ]);

      setCases(kycPayload.cases);
      setTransfers(transferPayload.transfers);
      setRiskItems(riskPayload.items);
      setAuditLogs(auditPayload.logs);
      setAdminUsers(teamPayload.users);
      if (selectedKycCase && !kycPayload.cases.some((item) => item.id === selectedKycCase.id)) {
        setSelectedKycCase(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load admin data");
    } finally {
      setIsLoading(false);
    }
  }

  async function decide(caseId: string, status: "approved" | "rejected") {
    setIsDeciding(caseId);
    setError(null);

    try {
      await api(
        apiBaseUrl,
        `/admin/kyc/${caseId}/decision`,
        adminToken,
        {
          method: "POST",
          body: JSON.stringify({
            status,
            ...(status === "rejected" ? { rejectionReason: "Manual compliance review did not approve this profile" } : {})
          })
        }
      );
      await refresh();
      if (selectedKycCase?.id === caseId) {
        await openKycCase(caseId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update KYC case");
    } finally {
      setIsDeciding(null);
    }
  }

  async function openKycCase(caseId: string) {
    setIsDetailLoading(true);
    setError(null);

    try {
      const payload = await api<{ case: KycCaseDetail }>(apiBaseUrl, `/admin/kyc-cases/${caseId}`, adminToken);
      setSelectedKycCase(payload.case);
      setSelectedTransfer(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load KYC detail");
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function openTransfer(transferId: string) {
    setIsDetailLoading(true);
    setError(null);

    try {
      const payload = await api<{ transfer: TransferDetail }>(apiBaseUrl, `/admin/transfers/${transferId}`, adminToken);
      setSelectedTransfer(payload.transfer);
      setSelectedKycCase(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load transfer detail");
    } finally {
      setIsDetailLoading(false);
    }
  }

  function openRiskItem(item: RiskItem) {
    if (item.entityType === "kyc_case") {
      void openKycCase(item.entityId);
      return;
    }

    void openTransfer(item.entityId);
  }

  function openAuditLog(log: AuditLog) {
    if (log.entityType === "kyc_case") {
      void openKycCase(log.entityId);
      return;
    }

    if (log.entityType === "transfer") {
      void openTransfer(log.entityId);
    }
  }

  function closeDetail() {
    setSelectedKycCase(null);
    setSelectedTransfer(null);
  }

  async function interveneTransfer(event: AdminTransferEvent, reason?: AdminTransferReason) {
    if (!selectedTransfer || adminUser?.role !== "admin") {
      return;
    }

    setIsIntervening(true);
    setError(null);

    try {
      await api(apiBaseUrl, `/admin/transfers/${selectedTransfer.id}/event`, adminToken, {
        method: "POST",
        body: JSON.stringify({
          event,
          ...(reason ? { reason } : {}),
          note: adminEventLabels[event]
        })
      });
      await refresh();
      await openTransfer(selectedTransfer.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update transfer");
    } finally {
      setIsIntervening(false);
    }
  }

  async function simulateProviderEvent(event: ProviderSimulationEvent) {
    if (!selectedTransfer || adminUser?.role !== "admin") {
      return;
    }

    setIsIntervening(true);
    setError(null);

    try {
      await api(apiBaseUrl, `/admin/transfers/${selectedTransfer.id}/provider-event`, adminToken, {
        method: "POST",
        body: JSON.stringify({
          event,
          idempotencyKey: `simulation:${selectedTransfer.id}:${event}:${Date.now()}`
        })
      });
      await refresh();
      await openTransfer(selectedTransfer.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not simulate provider event");
    } finally {
      setIsIntervening(false);
    }
  }

  async function createTeamUser() {
    setIsLoading(true);
    setError(null);
    setTemporaryPassword(null);

    try {
      const payload = await api<{ user: AdminUser; temporaryPassword?: string }>(apiBaseUrl, "/admin/users", adminToken, {
        method: "POST",
        body: JSON.stringify({
          email: teamEmail.trim(),
          role: teamRole
        })
      });
      setTeamEmail("");
      setTeamRole("compliance");
      setTemporaryPassword(payload.temporaryPassword ?? null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create operator");
    } finally {
      setIsLoading(false);
    }
  }

  async function updateTeamUser(user: AdminUser, input: { role?: AdminUser["role"]; disabled?: boolean }) {
    setIsLoading(true);
    setError(null);
    setTemporaryPassword(null);

    try {
      await api<{ user: AdminUser }>(apiBaseUrl, `/admin/users/${user.id}`, adminToken, {
        method: "PATCH",
        body: JSON.stringify(input)
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update operator");
    } finally {
      setIsLoading(false);
    }
  }

  async function resetTeamPassword(user: AdminUser) {
    setIsLoading(true);
    setError(null);
    setTemporaryPassword(null);

    try {
      const payload = await api<{ user: AdminUser; temporaryPassword?: string }>(
        apiBaseUrl,
        `/admin/users/${user.id}/reset-password`,
        adminToken,
        { method: "POST" }
      );
      setTemporaryPassword(payload.temporaryPassword ?? null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reset password");
    } finally {
      setIsLoading(false);
    }
  }

  async function revokeTeamSessions(user: AdminUser) {
    setIsLoading(true);
    setError(null);

    try {
      await api<{ revokedCount: number }>(
        apiBaseUrl,
        `/admin/users/${user.id}/revoke-sessions`,
        adminToken,
        { method: "POST" }
      );
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke sessions");
    } finally {
      setIsLoading(false);
    }
  }

  async function setupMfa() {
    setIsLoading(true);
    setError(null);
    try {
      const payload = await api<{ secret: string; otpauthUri: string }>(apiBaseUrl, "/admin/auth/mfa/setup", adminToken, { method: "POST" });
      setMfaSetupSecret(payload.secret);
      setMfaSetupUri(payload.otpauthUri);
      setMfaSetupCode("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start MFA setup");
    } finally {
      setIsLoading(false);
    }
  }

  async function enableMfa() {
    setIsLoading(true);
    setError(null);
    try {
      const payload = await api<{ adminUser: AdminUser }>(apiBaseUrl, "/admin/auth/mfa/enable", adminToken, {
        method: "POST",
        body: JSON.stringify({ mfaCode: mfaSetupCode })
      });
      setAdminUser(payload.adminUser);
      setMfaSetupSecret(null);
      setMfaSetupUri(null);
      setMfaSetupCode("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not enable MFA");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">V</div>
          <div>
            <strong>Velo</strong>
            <span>Control</span>
          </div>
        </div>
        <nav className="nav">
          <button className={activeTab === "compliance" ? "active" : ""} onClick={() => setActiveTab("compliance")} type="button"><ShieldCheck size={18} /> Compliance</button>
          <button className={activeTab === "transfers" ? "active" : ""} onClick={() => setActiveTab("transfers")} type="button"><CircleDollarSign size={18} /> Transfers</button>
          <button className={activeTab === "risk" ? "active" : ""} onClick={() => setActiveTab("risk")} type="button"><AlertTriangle size={18} /> Risk</button>
          <button className={activeTab === "audit" ? "active" : ""} onClick={() => setActiveTab("audit")} type="button"><ListChecks size={18} /> Audit</button>
          {adminUser?.role === "admin" ? (
            <button className={activeTab === "team" ? "active" : ""} onClick={() => setActiveTab("team")} type="button"><Users size={18} /> Team</button>
          ) : null}
        </nav>
        <div className="operator">
          <span>Operator</span>
          <strong>{adminUser?.email ?? "Signed out"}</strong>
          {adminUser ? <button className="secondary" onClick={logout} type="button">Sign out</button> : null}
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Internal operations</p>
            <h1>{pageTitle(activeTab)}</h1>
          </div>
          <div className="topbarControls">
            <input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
            <button className="iconButton" onClick={refresh} title="Refresh" type="button">
              <RefreshCw size={18} className={isLoading ? "spin" : ""} />
            </button>
          </div>
        </header>

        {error ? <div className="alert"><AlertTriangle size={18} /> {error}</div> : null}

        {!adminUser ? (
          <section className="loginPanel">
            <div>
              <p className="eyebrow">Secure operations</p>
              <h2>Sign in to Velo Control</h2>
            </div>
            <label>
              <span>Email</span>
              <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />
            </label>
            <label>
              <span>Password</span>
              <input value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} type="password" />
            </label>
            <label>
              <span>Authenticator code (if enabled)</span>
              <input inputMode="numeric" maxLength={6} value={loginMfaCode} onChange={(event) => setLoginMfaCode(event.target.value.replace(/\D/g, ""))} />
            </label>
            <button disabled={isLoading} onClick={login} type="button">Sign in</button>
          </section>
        ) : (
          <>

        <section className="metrics" aria-label="Compliance metrics">
          <Metric icon={<Clock3 size={20} />} label="Pending" value={String(metrics.pending)} />
          <Metric icon={<BadgeCheck size={20} />} label="Approved" value={String(metrics.approved)} />
          <Metric icon={<AlertTriangle size={20} />} label="High risk" value={String(metrics.highRisk)} />
          <Metric icon={<CircleDollarSign size={20} />} label="Recent USD volume" value={metrics.volume} />
        </section>

        {activeTab === "compliance" ? <section className="panel" id="kyc">
          <div className="panelHeader">
            <div>
              <h2>Identity reviews</h2>
              <p>{filteredCases.length} cases shown</p>
            </div>
            <div className="toolbar">
              <label className="searchBox">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cases" />
              </label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as KycStatus | "all")}>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>

          <div className="caseGrid">
            {filteredCases.map((item) => (
              <article className="caseCard" key={item.id}>
                <div className="caseHead">
                  <div>
                    <strong>{item.legalName ?? "Unnamed customer"}</strong>
                    <span>{item.user.email}</span>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <dl className="details">
                  <div><dt>Document</dt><dd>{humanize(item.documentType ?? "unknown")}</dd></div>
                  <div><dt>Provider</dt><dd>{item.provider ?? "manual"}</dd></div>
                  <div><dt>Country</dt><dd>{item.user.countryCode}</dd></div>
                  <div><dt>Submitted</dt><dd>{formatDate(item.submittedAt ?? item.user.createdAt)}</dd></div>
                </dl>
                <div className="caseActions">
                  <button className="secondary" onClick={() => openKycCase(item.id)} type="button">
                    <FileText size={16} /> Detail
                  </button>
                  <button disabled={item.status !== "pending" || isDeciding === item.id} onClick={() => decide(item.id, "approved")} type="button">
                    <Check size={16} /> Approve
                  </button>
                  <button className="danger" disabled={item.status !== "pending" || isDeciding === item.id} onClick={() => decide(item.id, "rejected")} type="button">
                    <X size={16} /> Reject
                  </button>
                </div>
              </article>
            ))}
            {!filteredCases.length ? <div className="emptyState"><UserCheck size={28} /> No cases match this view.</div> : null}
          </div>
        </section> : null}

        {activeTab === "transfers" ? <section className="panel" id="transfers">
          <div className="panelHeader">
            <div>
              <h2>Transfer monitor</h2>
              <p>{transfers.length} latest transfers</p>
            </div>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Recipient</th>
                  <th>Amount</th>
                  <th>Payout</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer) => (
                  <tr key={transfer.id} onClick={() => openTransfer(transfer.id)}>
                    <td>{transfer.sender.email}</td>
                    <td>{transfer.beneficiary.displayName}</td>
                    <td>{formatMoney(transfer.sourceAmount)} to {formatMoney(transfer.destinationAmount)}</td>
                    <td>{humanize(transfer.payoutMethod)}</td>
                    <td><StatusBadge status={transfer.status} /></td>
                    <td>{formatDate(transfer.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!transfers.length ? <div className="emptyState tableEmpty"><CircleDollarSign size={28} /> No transfers yet.</div> : null}
          </div>
        </section> : null}

        {activeTab === "risk" ? (
          <section className="panel" id="risk">
            <div className="panelHeader">
              <div>
                <h2>Risk queue</h2>
                <p>{riskItems.length} items requiring review</p>
              </div>
            </div>
            <div className="riskList">
              {riskItems.map((item) => (
                <button className="riskRow" key={item.id} onClick={() => openRiskItem(item)} type="button">
                  <span className={`severity severity-${item.severity}`}>{item.severity}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <StatusBadge status={item.status} />
                  <time>{formatDate(item.createdAt)}</time>
                </button>
              ))}
              {!riskItems.length ? <div className="emptyState"><AlertTriangle size={28} /> No risk items right now.</div> : null}
            </div>
          </section>
        ) : null}

        {activeTab === "audit" ? (
          <section className="panel" id="audit">
            <div className="panelHeader">
              <div>
                <h2>Audit search</h2>
                <p>{auditLogs.length} recent audit actions</p>
              </div>
              <div className="toolbar">
                <label className="searchBox">
                  <Search size={16} />
                  <input value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} placeholder="Search audits" />
                </label>
                <button className="secondary" onClick={refresh} type="button">Search</button>
              </div>
            </div>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Entity</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} onClick={() => openAuditLog(log)}>
                      <td>{humanize(log.action)}</td>
                      <td>{log.actorEmail ?? humanize(log.actorType)}</td>
                      <td>{log.entityType} / {log.entityId}</td>
                      <td>{formatDate(log.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!auditLogs.length ? <div className="emptyState tableEmpty"><ListChecks size={28} /> No audit logs match this search.</div> : null}
            </div>
          </section>
        ) : null}

        {activeTab === "team" && adminUser.role === "admin" ? (
          <section className="panel" id="team">
            <div className="panelHeader">
              <div>
                <h2>Team</h2>
                <p>{adminUsers.length} operators</p>
              </div>
            </div>
            {temporaryPassword ? (
              <div className="secretPanel">
                <strong>Temporary password</strong>
                <code>{temporaryPassword}</code>
              </div>
            ) : null}
            <div className="secretPanel">
              <strong>Multi-factor authentication</strong>
              <span>{adminUser.mfaEnabled ? "Enabled for your account." : "Not enabled for your account."}</span>
              {!adminUser.mfaEnabled ? <button className="secondary" disabled={isLoading} onClick={setupMfa} type="button">Set up MFA</button> : null}
              {mfaSetupSecret ? <code>{mfaSetupSecret}</code> : null}
              {mfaSetupUri ? <small>{mfaSetupUri}</small> : null}
              {mfaSetupSecret ? (
                <div className="teamCreate">
                  <input inputMode="numeric" maxLength={6} value={mfaSetupCode} onChange={(event) => setMfaSetupCode(event.target.value.replace(/\D/g, ""))} placeholder="6-digit code" />
                  <button disabled={isLoading || mfaSetupCode.length !== 6} onClick={enableMfa} type="button">Enable MFA</button>
                </div>
              ) : null}
            </div>
            <div className="teamCreate">
              <input value={teamEmail} onChange={(event) => setTeamEmail(event.target.value)} placeholder="operator@velo.local" />
              <select value={teamRole} onChange={(event) => setTeamRole(event.target.value as AdminUser["role"])}>
                <option value="compliance">Compliance</option>
                <option value="admin">Admin</option>
              </select>
              <button disabled={isLoading || !teamEmail.trim()} onClick={createTeamUser} type="button">
                Create
              </button>
            </div>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Last login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((user) => (
                    <tr key={user.id}>
                      <td>{user.email}</td>
                      <td>
                        <select value={user.role} onChange={(event) => updateTeamUser(user, { role: event.target.value as AdminUser["role"] })}>
                          <option value="compliance">Compliance</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td><StatusBadge status={user.disabledAt ? "disabled" : "active"} /></td>
                      <td>{user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"}</td>
                      <td>
                        <div className="rowActions">
                          <button className="secondary" disabled={isLoading} onClick={() => resetTeamPassword(user)} type="button">Reset</button>
                          <button className="secondary" disabled={isLoading} onClick={() => revokeTeamSessions(user)} type="button">Revoke sessions</button>
                          <button
                            className={user.disabledAt ? "secondary" : "danger"}
                            disabled={isLoading || user.id === adminUser.id}
                            onClick={() => updateTeamUser(user, { disabled: !user.disabledAt })}
                            type="button"
                          >
                            {user.disabledAt ? "Enable" : "Disable"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!adminUsers.length ? <div className="emptyState tableEmpty"><Users size={28} /> No operators yet.</div> : null}
            </div>
          </section>
        ) : null}
          </>
        )}
      </section>
      {selectedKycCase ? (
        <KycDetailPanel
          caseRecord={selectedKycCase}
          isLoading={isDetailLoading}
          isDeciding={isDeciding === selectedKycCase.id}
          onApprove={() => decide(selectedKycCase.id, "approved")}
          onClose={closeDetail}
          onOpenTransfer={openTransfer}
          onReject={() => decide(selectedKycCase.id, "rejected")}
        />
      ) : null}
      {selectedTransfer && adminUser ? (
        <TransferDetailPanel
          transfer={selectedTransfer}
          adminRole={adminUser.role}
          isLoading={isDetailLoading}
          isIntervening={isIntervening}
          onClose={closeDetail}
          onIntervene={interveneTransfer}
          onSimulateProvider={simulateProviderEvent}
        />
      ) : null}
    </main>
  );
}

function KycDetailPanel({
  caseRecord,
  isLoading,
  isDeciding,
  onApprove,
  onClose,
  onOpenTransfer,
  onReject
}: {
  caseRecord: KycCaseDetail;
  isLoading: boolean;
  isDeciding: boolean;
  onApprove: () => void;
  onClose: () => void;
  onOpenTransfer: (transferId: string) => void;
  onReject: () => void;
}) {
  return (
    <aside className="detailPanel" aria-label="KYC case detail">
      <DetailHeader eyebrow="Identity case" title={caseRecord.legalName ?? caseRecord.user.email} onClose={onClose} />
      <div className="detailBody">
        <StatusLine status={caseRecord.status} loading={isLoading} />
        <dl className="detailList">
          <div><dt>Email</dt><dd>{caseRecord.user.email}</dd></div>
          <div><dt>Phone</dt><dd>{caseRecord.user.phoneNumber ?? "Not set"}</dd></div>
          <div><dt>Country</dt><dd>{caseRecord.user.countryCode}</dd></div>
          <div><dt>Document</dt><dd>{humanize(caseRecord.documentType ?? "unknown")}</dd></div>
          <div><dt>Provider</dt><dd>{caseRecord.provider ?? "manual"}</dd></div>
          <div><dt>Provider case</dt><dd>{caseRecord.providerCaseId ?? "None"}</dd></div>
        </dl>
        <div className="detailActions">
          <button disabled={caseRecord.status !== "pending" || isDeciding} onClick={onApprove} type="button">
            <Check size={16} /> Approve
          </button>
          <button className="danger" disabled={caseRecord.status !== "pending" || isDeciding} onClick={onReject} type="button">
            <X size={16} /> Reject
          </button>
        </div>
        <DetailSection icon={<ListChecks size={17} />} title="Timeline">
          <Timeline events={caseRecord.timeline} />
        </DetailSection>
        <DetailSection icon={<CircleDollarSign size={17} />} title="Recent transfers">
          {caseRecord.recentTransfers.length ? (
            <div className="miniList">
              {caseRecord.recentTransfers.map((transfer) => (
                <button className="miniRow" key={transfer.id} onClick={() => onOpenTransfer(transfer.id)} type="button">
                  <span>{formatMoney(transfer.sourceAmount)} to {transfer.beneficiary.displayName}</span>
                  <StatusBadge status={transfer.status} />
                </button>
              ))}
            </div>
          ) : (
            <div className="softEmpty">No transfer history for this customer.</div>
          )}
        </DetailSection>
      </div>
    </aside>
  );
}

type AdminTransferEvent =
  | "COMPLIANCE_REVIEW_REQUIRED"
  | "COMPLIANCE_APPROVED"
  | "PAYOUT_SUBMITTED"
  | "PAYOUT_COMPLETED"
  | "FAIL"
  | "CANCEL";

type AdminTransferReason = "payout_failed" | "compliance_rejected" | "cancelled_by_admin";
type ProviderSimulationEvent = "payment_received" | "payout_submitted" | "payout_completed" | "payout_failed";

const adminEventLabels: Record<AdminTransferEvent, string> = {
  COMPLIANCE_REVIEW_REQUIRED: "Sent to compliance review",
  COMPLIANCE_APPROVED: "Compliance review approved",
  PAYOUT_SUBMITTED: "Payout submitted",
  PAYOUT_COMPLETED: "Payout completed",
  FAIL: "Marked failed by operations",
  CANCEL: "Cancelled by operations"
};

function TransferDetailPanel({
  transfer,
  adminRole,
  isLoading,
  isIntervening,
  onClose,
  onIntervene,
  onSimulateProvider
}: {
  transfer: TransferDetail;
  adminRole: AdminUser["role"];
  isLoading: boolean;
  isIntervening: boolean;
  onClose: () => void;
  onIntervene: (event: AdminTransferEvent, reason?: AdminTransferReason) => void;
  onSimulateProvider: (event: ProviderSimulationEvent) => void;
}) {
  return (
    <aside className="detailPanel wide" aria-label="Transfer detail">
      <DetailHeader eyebrow="Transfer detail" title={transfer.id} onClose={onClose} />
      <div className="detailBody">
        <StatusLine status={transfer.status} loading={isLoading} />
        <dl className="detailList">
          <div><dt>Sender</dt><dd>{transfer.sender.email}</dd></div>
          <div><dt>Recipient</dt><dd>{transfer.beneficiary.displayName}</dd></div>
          <div><dt>Source</dt><dd>{formatMoney(transfer.sourceAmount)}</dd></div>
          <div><dt>Destination</dt><dd>{formatMoney(transfer.destinationAmount)}</dd></div>
          <div><dt>Fee</dt><dd>{formatMoney(transfer.feeAmount)}</dd></div>
          <div><dt>Payout</dt><dd>{humanize(transfer.payoutMethod)}</dd></div>
        </dl>
        <DetailSection icon={<ShieldCheck size={17} />} title="Operations">
          {adminRole === "admin" ? (
            <div className="actionGrid">
              <button disabled={isIntervening} onClick={() => onIntervene("COMPLIANCE_REVIEW_REQUIRED")} type="button">
                Review
              </button>
              <button disabled={isIntervening} onClick={() => onIntervene("COMPLIANCE_APPROVED")} type="button">
                Approve
              </button>
              <button disabled={isIntervening} onClick={() => onIntervene("PAYOUT_SUBMITTED")} type="button">
                Submit payout
              </button>
              <button disabled={isIntervening} onClick={() => onIntervene("PAYOUT_COMPLETED")} type="button">
                Complete
              </button>
              <button className="danger" disabled={isIntervening} onClick={() => onIntervene("FAIL", "payout_failed")} type="button">
                Fail
              </button>
              <button className="danger" disabled={isIntervening} onClick={() => onIntervene("CANCEL", "cancelled_by_admin")} type="button">
                Cancel
              </button>
            </div>
          ) : (
            <div className="softEmpty">Transfer operations require an admin role.</div>
          )}
        </DetailSection>
        <DetailSection icon={<RefreshCw size={17} />} title="Provider simulation">
          {adminRole === "admin" ? (
            <div className="actionGrid">
              <button disabled={isIntervening} onClick={() => onSimulateProvider("payment_received")} type="button">
                Simulate payment
              </button>
              <button disabled={isIntervening} onClick={() => onSimulateProvider("payout_submitted")} type="button">
                Simulate payout
              </button>
              <button disabled={isIntervening} onClick={() => onSimulateProvider("payout_completed")} type="button">
                Simulate completion
              </button>
              <button className="danger" disabled={isIntervening} onClick={() => onSimulateProvider("payout_failed")} type="button">
                Simulate failure
              </button>
            </div>
          ) : (
            <div className="softEmpty">Provider simulation requires an admin role.</div>
          )}
        </DetailSection>
        <DetailSection icon={<ListChecks size={17} />} title="Timeline">
          <Timeline events={transfer.timeline} />
        </DetailSection>
        <DetailSection icon={<Split size={17} />} title="Ledger entries">
          {transfer.ledgerTransactions.length ? (
            <div className="ledgerStack">
              {transfer.ledgerTransactions.map((ledger) => (
                <div className="ledgerBlock" key={ledger.id}>
                  <div className="ledgerHead">
                    <strong>{ledger.memo}</strong>
                    <span>{formatDate(ledger.postedAt)}</span>
                  </div>
                  {ledger.entries.map((entry) => (
                    <div className="ledgerEntry" key={entry.id}>
                      <span>{entry.side}</span>
                      <strong>{formatMoney({ amountMinor: entry.amountMinor, currency: entry.currency })}</strong>
                      <code>{entry.accountId}</code>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="softEmpty">No ledger transactions posted yet.</div>
          )}
        </DetailSection>
        <DetailSection icon={<ShieldCheck size={17} />} title="Provider events">
          {transfer.providerEvents.length ? (
            <div className="miniList">
              {transfer.providerEvents.map((event) => (
                <div className="providerRow" key={event.id}>
                  <div>
                    <strong>{event.provider} {event.eventType}</strong>
                    <span>{event.errorMessage ?? event.idempotencyKey}</span>
                  </div>
                  <StatusBadge status={event.status} />
                </div>
              ))}
            </div>
          ) : (
            <div className="softEmpty">No provider events received yet.</div>
          )}
        </DetailSection>
      </div>
    </aside>
  );
}

function DetailHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <header className="detailHeader">
      <button className="iconButton light" onClick={onClose} title="Back" type="button">
        <ArrowLeft size={18} />
      </button>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
    </header>
  );
}

function StatusLine({ status, loading }: { status: string; loading: boolean }) {
  return (
    <div className="statusLine">
      <StatusBadge status={status} />
      {loading ? <span className="muted">Loading latest detail</span> : null}
    </div>
  );
}

function DetailSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="detailSection">
      <h3>{icon}{title}</h3>
      {children}
    </section>
  );
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) {
    return <div className="softEmpty">No timeline events yet.</div>;
  }

  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.id}>
          <div>
            <strong>{humanize(event.label)}</strong>
            {event.detail ? <span>{event.detail}</span> : null}
          </div>
          <time>{formatDate(event.createdAt)}</time>
        </li>
      ))}
    </ol>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{humanize(status)}</span>;
}

async function api<T>(
  apiBaseUrl: string,
  path: string,
  adminToken: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminToken}`,
      ...init.headers
    }
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return payload as T;
}

async function publicApi<T>(apiBaseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return payload as T;
}

function formatMoney(money: Money): string {
  const amount = Number.parseInt(money.amountMinor, 10) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currency,
    maximumFractionDigits: 2
  }).format(amount);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function pageTitle(tab: AdminTab): string {
  const titles: Record<AdminTab, string> = {
    compliance: "Compliance queue",
    transfers: "Transfer monitor",
    risk: "Risk queue",
    audit: "Audit search",
    team: "Team management"
  };

  return titles[tab];
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
