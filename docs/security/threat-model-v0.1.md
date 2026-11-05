# Threat model v0.1 (STRIDE summary)
- Spoofing: every path except Setup, sign-in and `/api/health` needs a signed session (OIDC code flow with PKCE, state and nonce checked, tenant and audience verified); the forwarded Easy Auth header is ignored unless `AUTH_MODE=easyauth`; demo mode refuses to start in App Service.
- Setup takeover (new): while unconfigured, saving settings needs a one-time code that exists only in the server log, compared in constant time, with a 5-guess lockout; setup is closed (404/409) once complete; credentials are verified with Microsoft before saving.
- Secret handling (new): client secret and session key live in one Key Vault secret; the settings API never returns the secret; no file fallback in production.
- Tampering: mutating routes require same-origin, a custom header and a server-side role check; admin override of the active-session safety check is Admin-only.
- Repudiation: every action, including refused ones, is audited with the Entra object id.
- Information disclosure: no secrets in app settings (managed identity throughout); telemetry stays in the customer's Application Insights; strict security headers.
- Denial of service: ARM calls retry with backoff; the watchdog caps actions per run and per pool.
- Elevation of privilege: custom least-privilege RBAC roles scoped to the managed resource groups only; write and Run Command roles are separate and off by default.

Open items: restrict the web identity's Key Vault write access to the single settings secret (ABAC condition); federated credential instead of a client secret; rate limiting on sign-in;  nonce-based CSP (currently allows inline scripts for Next.js hydration); durable audit storage; the watchdog Function has settings validation but no automated tests yet; no end-to-end deploy into a clean subscription has been run.

## Independent review of sign-in (fixed and open)

Fixed: demo mode now refused on any Azure host (App Service, Container Apps, AKS) and the front door uses the same rule; open redirect via control characters in `returnTo`; logout now expires the `__Host-` cookie with the right attributes and checks Origin; setup is single-flight and the store refuses to overwrite (`createOnly`); changing tenant or client ID signs everyone out; session lifetime 8h to 4h.

Open (tracked): sessions are stateless so a stolen cookie works until expiry (use Settings > sign everyone out; add session versioning and periodic role re-check); first admin is matched by email, bind to the Entra object ID on first sign-in instead; require `PUBLIC_BASE_URL` in production; a deleted Key Vault secret reopens setup (needs the log code); setup lockout is per instance.
