# Threat model v0.1 (STRIDE summary)
- Spoofing: Easy Auth required on all paths except `/api/health`; demo mode refuses to start in App Service.
- Tampering: mutating routes require same-origin, a custom header and a server-side role check; admin override of the active-session safety check is Admin-only.
- Repudiation: every action, including refused ones, is audited with the Entra object id.
- Information disclosure: no secrets in app settings (managed identity throughout); telemetry stays in the customer's Application Insights; strict security headers.
- Denial of service: ARM calls retry with backoff; the watchdog caps actions per run and per pool.
- Elevation of privilege: custom least-privilege RBAC roles scoped to the managed resource groups only; write and Run Command roles are separate and off by default.

Open items: nonce-based CSP (currently allows inline scripts for Next.js hydration); durable audit storage; the watchdog Function has settings validation but no automated tests yet; no end-to-end deploy into a clean subscription has been run.
