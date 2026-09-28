# Remittance

Velo is a mobile-first remittance and digital finance project for Great Lakes and East African users.

The repository contains an Expo customer app, a Vite admin dashboard, a TypeScript API and reconciliation worker, and shared PostgreSQL/Prisma, ledger, and transfer packages.

## Project Status

Development and simulated staging workflows are implemented. Real provider integrations, financial correctness review, regulatory arrangements, and device validation remain launch prerequisites. The current refund journal implementation does not establish that funds have actually been returned.

Customer discovery is underway to select one payment route and validate demand, delivery feasibility, and economics before expanding the product.

## Documentation

- [Project handoff and architecture](docs/PROJECT_START.md)
- [Five-day customer validation plan](docs/FIVE_DAY_VALIDATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Mobile validation](docs/MOBILE_VALIDATION.md)
- [Launch checklist](docs/LAUNCH_CHECKLIST.md)

## Development

Requires Node.js 22 or newer and PostgreSQL; Docker is used for the local database and staging stack. Use `.env.example` as the local configuration reference. Never commit real credentials.

```sh
npm ci
npm run db:generate
npm run typecheck
npm run dev:db
npm run db:migrate:dev
npm run dev:api
```

In separate terminals:

```sh
npm run dev:admin
npm run dev:mobile
```

## Verification

```sh
npm run test:domain
npm run test:reliability
npm run test:security
npm run test:e2e
```

Security database tests and E2E tests require the appropriate running services. See the deployment guide for staging configuration. Example staging credentials are for local development only.
