# Putting Tidewatch online (your own Azure subscription)

Status: the template compiles and the app builds and passes its tests, but a full deployment into a clean subscription has not been run yet. Do the first one in a test subscription.

You need: Owner (or Contributor plus User Access Administrator) on the target subscription, and an Entra app registration you can edit.

## 1. Deploy (no Entra IDs needed)
1. Fill in `infra/main.bicepparam`: region, resource group names, and `managedResourceGroupIds` (the resource groups holding your host pools). Do not commit it with real values.
2. `az deployment sub create --location <region> --template-file infra/main.bicep --parameters infra/main.bicepparam`. It starts read-only (`enableWebActions=false`) with the watchdog in Report mode. Note the `webAppUrl` and `entraRedirectUri` outputs.
3. Publish the web app: `cd apps/web && npm ci && npm run build`, zip the standalone output (`.next/standalone`, plus `.next/static` and `public` copied inside it), and `az webapp deploy --type zip`.

## 2. Prepare the app registration (Entra admin centre)
1. Authentication, Add a platform, **Web**, redirect URI = the `entraRedirectUri` output (`https://<app>.azurewebsites.net/auth/callback`).
2. Certificates and secrets, New client secret. Copy the **Value** now (it is shown once).
3. Optional but recommended: App roles, create three roles with values exactly `Reader`, `Operator`, `Admin` (members: Users/Groups), then assign people in Enterprise applications, your app, Users and groups. Without roles only the person who completes setup (an Admin) can use the site.

## 3. First-run Setup (on the site)
1. Open the web app URL. You land on the Setup page.
2. Get the **setup code**: Azure portal, the web app, Monitoring, **Log stream**, line `TIDEWATCH SETUP CODE`. (It is only ever in the log.)
3. Enter the setup code, tenant ID, client ID, client secret value and your own sign-in email. Press Save. The app checks the details with Microsoft first and tells you if they are wrong; nothing is saved until they work.
4. You are sent to Microsoft to sign in and arrive as an Admin.

Later changes (new secret, different app registration, sign everyone out) are on the **Settings** page, Admin only.

## 4. Turn things on when ready
Set `enableWebActions=true` and, if you want automatic fixing, `watchdogMode=Remediate`, then redeploy (role assignments follow these switches).

## Troubleshooting
- Setup says "Microsoft rejected these details": the message includes Microsoft's error code (for example AADSTS7000215 = wrong secret value, AADSTS700016 = wrong client ID).
- Sign-in says the redirect URI does not match: the URI in the app registration must equal the one shown on the Setup/Settings page exactly.
- You see "signed in but have no role": you are not the setup email and have no app role yet.
