# Database Schema

The durable system of record is PostgreSQL through Prisma.

Schema file:

```text
packages/db/prisma/schema.prisma
```

## First-Principles Rules

- Monetary amounts are stored as integer minor units.
- Ledger transactions are idempotent through `LedgerTransaction.idempotencyKey`.
- Provider events are stored before processing and deduplicated through `ProviderEvent.idempotencyKey`.
- Transfer creation is idempotent through `Transfer.idempotencyKey`.
- Ledger entries are append-only in application behavior. Do not update or delete posted entries.
- State changes are recorded in `TransferStateChange`.
- Admin and system actions are recorded in `AuditLog`.

## Core Tables

- `User`: account, role, country, and KYC status.
- `KycCase`: provider-backed identity/compliance review cases.
- `Beneficiary`: payout recipients and tokenized payout handles.
- `TransferQuote`: quoted source amount, fee, exchange rate, destination amount, and expiry.
- `Transfer`: accepted transfer lifecycle record.
- `TransferStateChange`: audit trail for status transitions.
- `ProviderEvent`: raw webhook/provider event persistence.
- `LedgerAccount`: named account per currency.
- `LedgerTransaction`: idempotent group of balanced ledger entries.
- `LedgerEntry`: debit or credit posting.
- `AuditLog`: operational audit trail.

## Next Implementation Step

Replace the API's in-memory quote and transfer maps with repository functions backed by this schema.

## Local Database

Start PostgreSQL:

```bash
npm run dev:db
```

Run migrations:

```bash
npm run db:migrate:dev
```
