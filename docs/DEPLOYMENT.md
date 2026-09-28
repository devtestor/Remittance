# Velo Production Deployment

## Scope

This deployment starts Velo as a single production stack with PostgreSQL, Redis, the API, the reconciliation worker, and the admin dashboard. It is suitable for controlled MVP traffic. Add managed database, Redis, secrets, backups, and multiple API replicas before high-volume launch.

## Required preparation

1. Copy `.env.production.example` to `.env.production`.
2. Replace every `replace-me` value with a secret from the deployment secret manager.
3. Set `VITE_API_BASE_URL` to the public API URL.
4. Configure the API callback URL and public policy/logo URLs with real HTTPS addresses.
5. Restrict inbound access so PostgreSQL and Redis are never public.

## Deploy

```bash
docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml run --rm api npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
docker compose --env-file .env.production -f docker-compose.production.yml up -d
curl -f http://127.0.0.1:4000/ready
```

The admin dashboard is exposed on `127.0.0.1:8080`; put it behind an HTTPS reverse proxy. The API is exposed on `127.0.0.1:4000` for the same reason.

## Operations

- Back up PostgreSQL before every migration.
- Keep Redis persistence optional; rate limits may be rebuilt after a Redis restart.
- Alert on API readiness failures, worker process exits, provider retry exhaustion, failed KYC callbacks, and payout failures.
- Review `npm run test:e2e` against a staging API before each release.
- Never use development admin credentials in production.

## Local staging

The repository includes an isolated staging profile that uses ports `4100` for the API, `8180` for the admin dashboard, `5543` for PostgreSQL, and `6380` for Redis.

```bash
npm run staging:up
docker compose -f docker-compose.production.yml -f docker-compose.staging.yml run --rm api npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
curl -f http://127.0.0.1:4100/ready
API_BASE_URL=http://127.0.0.1:4100 npm run test:e2e
```

Open the staging admin dashboard at `http://127.0.0.1:8180`. Staging credentials are defined in `.env.staging.example` and must never be reused in production.
