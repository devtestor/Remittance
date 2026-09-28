# Velo Launch Checklist

## Security gates

- [ ] Production secrets are stored outside the repository.
- [ ] `ADMIN_API_KEY` is unset in production.
- [ ] Admin MFA is enabled for every operator.
- [ ] Admin password delivery uses Resend or an approved provider.
- [ ] PostgreSQL and Redis have no public listener.
- [ ] HTTPS is enforced for the admin app, API, and provider callbacks.
- [ ] Database backups and restore testing are complete.
- [ ] Rate-limit alerts and provider retry alerts are monitored.

## Corridor gates

- [ ] One sender country and one recipient country are approved.
- [ ] One payment method and one payout method are approved.
- [ ] KYC and sanctions review procedures are documented.
- [ ] Provider sandbox callbacks have passed signature tests.
- [ ] Fees, FX, refund, failure, and complaint policies are published.
- [ ] Manual operations coverage exists during launch hours.

## Mobile gates

- [ ] Expo web smoke flow passes against staging.
- [ ] Android emulator or Expo Go reaches the API using the documented device URL.
- [ ] Onboarding, OTP, KYC, beneficiary, quote, transfer, history, and sign-out flows are verified on a real target device.
- [ ] App relaunch restores or clears the session according to the expected sign-in state.

## Release gates

- [ ] `npm run typecheck` passes.
- [ ] `npm run test:security` passes.
- [ ] `npm run test:e2e` passes against staging.
- [ ] Admin can inspect transfer, provider, ledger, and audit timelines.
- [ ] A failed payout and duplicate callback have been rehearsed.
- [ ] Rollback and migration recovery procedures are documented.

## Staging rehearsal

- [ ] `npm run staging:up` starts all services.
- [ ] Staging `/ready` returns HTTP 200.
- [ ] Staging migrations apply cleanly.
- [ ] `API_BASE_URL=http://127.0.0.1:4100 npm run test:e2e` passes.
- [ ] Staging admin login, MFA setup, lockout, and session revocation are exercised.
