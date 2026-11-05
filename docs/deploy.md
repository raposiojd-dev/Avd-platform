# Putting it online (your own Azure subscription)

Status: the template compiles and the app builds, but a full deployment into a clean subscription has not been run yet. Do the first one in a test subscription.

You need: Owner (or Contributor plus User Access Administrator) on the target subscription, and rights to create an Entra app registration.

1. **Create the Entra app registration** for sign-in (single tenant). Add a Web redirect URI of `https://<your-app-name>.azurewebsites.net/.auth/login/aad/callback`. Under *App roles* create three roles named exactly `Reader`, `Operator`, `Admin` (allowed member types: Users/Groups). Note the Application (client) ID and your tenant ID. The template wires the sign-in secret-free with a managed identity, so you do not create a client secret.
2. **Fill in `infra/main.bicepparam`** with your region, resource group names, the resource groups that hold your AVD host pools (`managedResourceGroupIds`), the tenant ID and the app registration client ID. Do not commit this file with real values.
3. **Deploy:** `az deployment sub create --location <region> --template-file infra/main.bicep --parameters infra/main.bicepparam`. It starts read-only (`enableWebActions=false`) and the watchdog in Report mode.
4. **Assign people to the app roles** in Entra (Enterprise applications, your app, Users and groups). Without a role a signed-in user sees nothing.
5. **Publish the web app:** build with `cd apps/web && npm ci && npm run build`, zip the standalone output (`.next/standalone` plus `.next/static` and `public`), and deploy it to the App Service with `az webapp deploy --type zip`.
6. Open the site. Check the Hosts page lists every session host, then the Sessions page.
7. When happy, set `enableWebActions=true` and, if you want automatic fixing, `watchdogMode=Remediate`, and redeploy (role assignments follow these switches).
