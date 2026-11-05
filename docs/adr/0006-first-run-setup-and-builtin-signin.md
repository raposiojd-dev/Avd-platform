# ADR 0006: First-run Setup page and built-in Entra sign-in
Status: accepted (John chose this on 2026-11-06). Supersedes ADR 0004 as the default; `authMode=easyauth` remains available.

Why: the Entra app registration (tenant ID, client ID, client secret) must not be in any file or deployment parameter file, and John wants to enter it on the site itself. App Service Authentication needs those values before the site can start, so it cannot offer a Setup page. The app therefore signs people in itself (OpenID Connect authorization code flow with PKCE, via MSAL Node, the project default).

How it works
- Until configured, the site shows only a Setup page. Saving needs a one-time **setup code** that is printed once to the server log (App Service Log stream), so only someone with access to the deployment can complete setup. Five wrong codes lock setup for 15 minutes.
- The entered values are checked against Microsoft (a token request with the client secret) before they are saved, then stored as a single Key Vault secret using the web app's managed identity. In production there is no file fallback.
- The person who completes setup is always an Admin (their sign-in email is stored), so nobody is locked out. Everyone else gets Reader, Operator or Admin from Entra app roles (the `roles` claim). A signed-in user without a role sees nothing.
- Sessions are signed (HS256) HttpOnly, Secure, SameSite=Lax cookies for 8 hours. An Admin can sign everyone out from Settings, which rotates the signing key. Login state (state, nonce, PKCE verifier) is signed and expires in 10 minutes; the ID token's tenant, audience and nonce are checked.
- After setup, `/setup` returns 404 and the setup API returns 409.

Trade-offs and what this costs
- The web app's identity needs **Key Vault Secrets Officer** on the product's own vault (write access to secrets). Scoped to that vault only. A tighter option is an ABAC condition limiting it to the one secret name; not done yet.
- A client secret expires (default 6 months, up to 24) and must be renewed in Settings. A federated credential would avoid the secret; tracked for v1.
- More code to secure than Easy Auth: this is why sign-in has its own tests, and why a security review of `lib/session.ts`, `lib/entra.ts` and `app/api/setup` is required before release.
- Before the site is configured, anyone who can reach the URL can see the Setup page (not use it). Mitigate by deploying and completing setup straight away.
