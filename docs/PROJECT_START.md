




# Remittance App Project Start

This document is the handoff point for any engineer or agent starting work on this app. Read this first, then follow the build order below.

## Product Direction

Build a mobile-first remittance and digital finance app for Velo, serving Great Lakes and East African users. The product should support sender onboarding, KYC, beneficiaries, transfer creation, payment collection, payout tracking, transaction history, and admin/compliance operations.

Existing Stitch design source:

- Project: `Velo Crypto Remit`
- Stitch project ID: `3994912229481387974`
- Design system: `Premium East African Finance`
- Primary style: deep trust blue, growth green, Manrope headlines, Work Sans body text, mobile-first financial UI

## Recommended Stack

- Mobile app: Expo, React Native, TypeScript
- Admin dashboard: Next.js, TypeScript
- Backend API: NestJS, TypeScript
- Worker: TypeScript, BullMQ, Redis
- Database: PostgreSQL
- ORM/migrations: Prisma
- Shared packages: TypeScript workspaces
- Future performance services: Rust only when a bottleneck is proven
- Future analytics/fraud jobs: Python only when data workflows require it

## Repository Shape

```text
apps/
  mobile/        Customer mobile app
  admin/         Internal operations and compliance dashboard
  api/           Backend API and domain services
  worker/        Background jobs and provider reconciliation

packages/
  config/        Environment validation and shared config
  db/            Prisma schema, migrations, and database client
  ledger/        Double-entry ledger domain logic
  transfers/     Quote calculation and transfer lifecycle rules
  types/         Shared API and domain types
  ui/            Shared design tokens and reusable UI primitives

docs/
  PROJECT_START.md
```

## Core Domains

- Auth and sessions
- User profile
- KYC and compliance status
- Beneficiaries
- Transfer quote
- Transfer creation
- Payment collection
- Payout orchestration
- Double-entry ledger
- FX rates and fees
- Provider webhooks
- Notifications
- Admin actions
- Audit logs
- Risk review
- Creator Bridge service cases, documents, provider applications, and verified payout accounts

## Non-Negotiable Engineering Rules

- Money movement must be idempotent.
- Ledger entries must be immutable after posting.
- Every provider webhook must be stored before processing.
- Transfer state transitions must be explicit and auditable.
- Admin actions must write audit events.
- Fee and FX calculations must be testable pure functions.
- Sensitive data must be encrypted or tokenized where appropriate.
- Do not add Rust or Python services until TypeScript becomes a clear limitation.

## Initial Build Order

1. Create the monorepo workspace and shared TypeScript config.
2. Define shared domain types for users, beneficiaries, transfers, ledger entries, KYC, and providers.
3. Define the database schema and migrations.
4. Build the API transfer state machine and ledger posting rules.
5. Build mobile onboarding, dashboard, beneficiary, quote, review, and transfer status screens.
6. Build admin user search, transfer monitoring, KYC review, risk queue, and audit log views.
7. Add provider integrations behind stable internal interfaces.
8. Add webhook persistence, retries, reconciliation jobs, and operational alerts.
9. Add compliance hardening, rate limits, MFA, and security review.
10. Launch narrowly: one sender country, one recipient country, one payment method, one payout method.

## MVP Boundaries

The first MVP should prove one complete transfer flow:

- User signs up.
- User completes basic KYC.
- User adds a beneficiary.
- User requests a quote.
- User confirms a transfer.
- System records ledger entries.
- Provider webhook updates transfer status.
- User sees transaction status.
- Admin can inspect the user, transfer, provider events, and audit trail.

## Current Build Status

- Monorepo scaffold exists.
- API has health, OTP auth, sessions, beneficiaries, transfer quotes, transfers, wallet summary, manual KYC, admin KYC queue reads, admin KYC decisions, admin transfer monitoring, admin user management, and Smile ID KYC provider hooks.
- API exposes `/ready` for database-backed readiness checks, and the repository includes `npm run test:e2e` for the complete local transfer release smoke test.
- Mobile web/app has branded Velo onboarding, OTP verification, Smile-hosted web KYC launch, manual KYC fallback, KYC status refresh, wallet, recipient, quote, review, transfer status, and history screens.
- Admin web has a Velo compliance dashboard with metrics, KYC filters/search, audited approve/reject actions, transfer monitoring, transfer interventions, risk queue, audit search, KYC detail panels, transfer detail panels, timelines, ledger entries, provider event context, and an admin-only Team tab for operator management.
- PostgreSQL and Prisma migrations exist for users, sessions, OTP challenges, KYC cases, beneficiaries, quotes, transfers, ledger transactions, and ledger entries.
- Admin auth uses `AdminUser` and `AdminSession` records. Dashboard login stores a bearer token, disabled operators are blocked from login/session use, password resets clear active sessions, last login is tracked, and admin audit logs can include operator identity.
- Security hardening includes Redis-backed rate limits with a local fallback for OTP request/verification and admin login, persistent five-attempt admin lockouts, bearer-session logout, admin session revocation from the Team tab, audited revocation actions, and TOTP MFA setup/verification for admin operators.
- Automated security tests cover RFC-compatible TOTP codes, authenticator setup material, rate-limit enforcement, and PostgreSQL-backed admin lockout/reset behavior. Run them with `npm run test:security`.
- Transfer and ledger correctness are covered by the shared domain packages and typecheck.

## Current KYC Direction

Manual KYC remains the local fallback. Smile ID is the first real identity provider integration.

Backend routes:

- `POST /users/:id/kyc` creates a manual pending KYC case.
- `POST /users/:id/kyc/smile-token` creates or reuses a Smile-backed KYC case and returns a hosted web token when `KYC_PROVIDER=smile`.
- `POST /kyc/smile/callback` receives Smile callback results and updates the Velo user KYC status.
- `GET /admin/kyc-cases?status=pending` lists compliance cases with user context.
- `POST /admin/auth/login` signs in an admin user and returns a session token.
- `GET /admin/auth/me` restores the current admin session from `Authorization: Bearer`.
- `GET /admin/kyc-cases/:caseId` returns a KYC case detail, user context, timeline, and recent transfers.
- `POST /admin/kyc/:caseId/decision` approves or rejects a compliance case.
- `GET /admin/transfers` lists the latest transfers with sender and recipient context.
- `GET /admin/transfers/:transferId` returns transfer detail, state timeline, ledger entries, provider events, sender, and recipient context.
- `POST /admin/transfers/:transferId/event` applies an allowed transfer state-machine event and writes an audit log.
- `GET /admin/risk-queue` lists KYC, transfer, and intervention items requiring operator attention.
- `GET /admin/audit-logs?query=transfer` searches recent audit actions.
- `GET /admin/users` lists admin/compliance operators. Requires `admin`.
- `POST /admin/users` creates an operator. Development returns a one-time temporary password; production delivers it through the configured provider. Requires `admin`.
- `PATCH /admin/users/:id` changes operator role or disabled status. Requires `admin`.
- `POST /admin/users/:id/reset-password` rotates an operator password, clears active sessions, and delivers the new temporary password through the configured provider. Requires `admin`.

Required Smile environment:

```env
KYC_PROVIDER="smile"
SMILE_PARTNER_ID="your-smile-partner-id"
SMILE_API_KEY="your-smile-api-key"
SMILE_CALLBACK_URL="https://your-public-api.example.com/kyc/smile/callback"
SMILE_SID_SERVER="0"
EXPO_PUBLIC_SMILE_PARTNER_ID="your-smile-partner-id"
EXPO_PUBLIC_SMILE_CALLBACK_URL="https://your-public-api.example.com/kyc/smile/callback"
EXPO_PUBLIC_SMILE_POLICY_URL="https://your-public-site.example.com/privacy"
EXPO_PUBLIC_SMILE_LOGO_URL="https://your-public-site.example.com/velo-logo.png"
EXPO_PUBLIC_SMILE_ENVIRONMENT="sandbox"
```

`SMILE_SID_SERVER="0"` and `EXPO_PUBLIC_SMILE_ENVIRONMENT="sandbox"` are sandbox. Use production values only after provider approval.

Local admin dashboard:

```shell
npm run dev:api
npm run dev -w @glr/admin
```

Open `http://localhost:5173/` and sign in with the local admin account.

Local admin login:

```text
Email: admin@velo.local
Password: velo-admin-dev
```

Local compliance login:

```text
Email: compliance@velo.local
Password: velo-compliance-dev
```

The legacy `x-admin-api-key` fallback is development-only. The dashboard uses bearer sessions.

Role rules: `admin` can read admin data, review KYC, intervene on transfer/payout states, and manage operators. `compliance` can read admin data and review KYC, but cannot change transfer/payout states or manage operators.

Next admin task: add webhook security regression tests. Admin password delivery uses Resend in production and console delivery in development. Redis is configured with `REDIS_URL`; the API falls back to local limits only when Redis is unavailable.

Next KYC task: add real Smile sandbox credentials plus public policy/logo URLs, expose the callback through a public tunnel or deployed API URL, and run a full hosted-widget callback test.

## Product Expansion: Creator Bridge

The product brief for the creator and small-business international payments service is in [`docs/CREATOR_BRIDGE.md`](./CREATOR_BRIDGE.md). The first implementation should be a simulated service-request and provider-reconciliation workflow, separate from `Transfer`, so LLC formation and payout onboarding do not get confused with money movement.

## Immediate Next Task

Run the simulated transfer lifecycle from the admin dashboard and verify duplicate provider events remain harmless. The worker now detects stale received or failed provider events and retries them with a bounded counter; the next reliability task is to extract the API and worker event application code into one shared processor. Keep the Smile hosted-widget path ready for sandbox testing once credentials and public URLs are available.
