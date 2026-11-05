# Tidewatch

A web console for Azure Virtual Desktop that deploys into **your own** Azure subscription. No credentials or data leave your tenant.

- `apps/web` Next.js + TypeScript console (Overview, Hosts, Watchdog, Audit log). `FLEET_PROVIDER=demo npm run dev` runs it on sample data with no Azure needed.
- `functions/watchdog` Azure Function that finds session hosts stuck after hibernate resume and fixes them.
- `tools/` standalone PowerShell version of the watchdog and its least-privilege role definition.
- `infra/` Bicep template for customer-hosted deployment. Nothing environment-specific is committed; everything is supplied at deploy time.
- `docs/` decision records and security notes.

## Run locally
```
cd apps/web && npm install && cp .env.example .env.local && npm run dev
```
Tests: `npm test`. Type check: `npm run typecheck`.

Status: early MVP, unreleased. The watchdog defaults to report-only.
