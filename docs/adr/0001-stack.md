# ADR 0001: Stack
Status: accepted (follows the project default architecture)

Next.js + TypeScript on Azure App Service (Linux, Node 22). Background work in Azure Functions (PowerShell 7.4 where it suits). Application Insights for logs, Key Vault for any secret, managed identity for all Azure access. Customer-hosted, single tenant, deployed by one Bicep template.

Deferred: Azure SQL. The MVP keeps no product data of its own: fleet state is read live from Azure Resource Graph and Compute, and the audit log is an in-memory ring (ADR 0005 will move it to durable storage before v1).
