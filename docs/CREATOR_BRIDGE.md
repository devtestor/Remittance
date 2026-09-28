# Velo Creator Bridge

## Product intent

Velo can help Rwandan creators and small digital businesses receive legitimate international income without depending on friends or relatives abroad to hold accounts for them.

The service is a managed onboarding and payout-readiness workflow. It may coordinate formation partners, payment-platform onboarding, tax documentation, and payouts to MTN MoMo or a local bank. It must never promise approval by a bank, Stripe, PayPal, TikTok, or another platform.

## Customer promise

One guided path from international earnings to a verified local payout method.

Velo should make the process understandable, trackable, and auditable. Customers should always know which service they requested, what documents are required, which provider is reviewing the application, what fees apply, and whether a payout is pending, approved, rejected, or blocked for compliance.

## Initial service catalog

### US company setup assistance

- Formation partner selection and state comparison.
- Name and beneficial-owner intake.
- Formation document collection.
- EIN and registered-agent workflow where eligible.
- Annual-report and registered-agent renewal reminders.

### UK company setup assistance

- Formation partner selection.
- Director and beneficial-owner intake.
- Companies House document collection.
- Confirmation-statement and annual-account reminders.

### Creator payout readiness

- Payout-platform eligibility checklist.
- Identity and business verification preparation.
- Tax-form readiness such as W-8BEN or W-8BEN-E where applicable.
- Platform account ownership and recovery guidance.
- Sponsorship invoice and receipt workflow.

### Local payout setup

- MTN MoMo beneficiary verification.
- Local bank-account verification.
- Currency, fee, and expected-settlement estimate.
- Payout status and reconciliation.

## Important boundaries

Velo must not:

- Open or control accounts using a friend’s identity.
- Manufacture addresses, documents, invoices, tax forms, or platform activity.
- Guarantee Stripe, PayPal, TikTok, sponsorship, bank, or payment-processor approval.
- Hide the ultimate beneficial owner or source of funds.
- Process payouts before required KYC, sanctions, and source-of-funds checks pass.
- Present legal or tax advice unless delivered by a qualified partner in the relevant jurisdiction.

Formation, tax, and provider fees should be shown separately at checkout where applicable. Provider decisions remain outside Velo’s control.

## Recommended first release

Start with a service-request workflow before attempting automatic company formation:

1. Customer chooses `US setup`, `UK setup`, `payout readiness`, or `local payout only`.
2. Customer completes personal, business, beneficial-owner, and source-of-funds intake.
3. Velo creates a case with a document checklist and transparent estimate.
4. Compliance requests documents, approves partner submission, or rejects the case with a reason.
5. An authorized formation or payments partner processes the external application.
6. Velo records provider references and status events.
7. Once a payout method is verified, the customer can route eligible earnings to MTN MoMo or a bank beneficiary.

This release can be tested with simulated provider events and does not require live banking credentials.

## Core domain model

Keep this service domain separate from `Transfer`:

- `BridgeCase`: customer request, service type, jurisdiction, status, estimate, assigned operator.
- `BridgeDocument`: required document, upload metadata, review status, rejection reason.
- `BusinessProfile`: legal name, trade name, jurisdiction, beneficial owners, tax identifiers.
- `ProviderApplication`: external provider, application reference, status, submitted and decided timestamps.
- `PayoutAccount`: verified MTN MoMo or bank destination, ownership status, masked token.
- `BridgeEvent`: immutable provider or operator event with raw payload reference and processing status.

Suggested case statuses: `draft` -> `intake_complete` -> `compliance_review` -> `documents_required` -> `ready_for_partner` -> `submitted` -> `approved` / `rejected` / `cancelled`.

## Delivery roadmap

### Phase 1: Case intake and simulation

- Add the bridge case schema and API.
- Add mobile service selection and intake form.
- Add admin case queue and document checklist.
- Add simulated provider application events.
- Add local payout-account verification in sandbox mode.

### Phase 2: Partner operations

- Integrate one vetted formation partner.
- Integrate one payout-readiness provider.
- Store provider webhooks before processing.
- Add retries, reconciliation, and operator alerts.

### Phase 3: Revenue and retention

- Add service quotes and invoices.
- Add renewal reminders for registered-agent, annual-report, and confirmation-statement obligations.
- Add creator sponsorship invoicing and receipts.
- Add referral and partner reporting.

## Build decision

Use the existing TypeScript API, Prisma/PostgreSQL, worker, and admin dashboard. Add Rust or Python only after measured workload requires it. Provider adapters should sit behind stable internal interfaces so the first formation or payout partner can be replaced without changing the customer workflow.
