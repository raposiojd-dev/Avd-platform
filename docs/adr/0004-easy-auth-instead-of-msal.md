# ADR 0004: App Service Authentication (Easy Auth) instead of MSAL in the app
Status: proposed, needs John's approval. This departs from the project default ("Entra ID sign-in via MSAL").

Why: with Easy Auth, App Service validates the Entra ID token before any request reaches our code, so no token handling, session store or client secret lives in the app. The app registration uses a managed-identity federated credential, so there is no secret to rotate. The app still enforces authorisation itself: Entra app roles (Reader, Operator, Admin) arrive in the `x-ms-client-principal` header and are checked server-side on every API route.

Trade-offs: ties the product to App Service (Container Apps also supports built-in auth); less control over the sign-in UX; the `/api/health` liveness path is the only path excluded from sign-in.
Reference: https://learn.microsoft.com/azure/app-service/overview-authentication-authorization
