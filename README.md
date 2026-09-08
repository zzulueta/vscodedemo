# Global AI Manila

A server-rendered Node.js 22 / Express community website backed by Azure Cosmos DB for NoSQL.

## Features

- Home, About Us, Events, and Contact Us pages, using the supplied chapter logo.
- Member signup, sign-in, profile editing, password changes, and registration status.
- Administrator event creation on the Events page and registration approval/rejection.
- Contact submissions stored in Cosmos DB, with an administrator inbox and email reply links.
- Parameterized database queries, scrypt password hashes, expiring server-side sessions, CSRF protection, security headers, rate limits, and server-enforced roles.
- Cosmos DB optimistic concurrency prevents conflicting decisions. Duplicate registrations are rejected using a deterministic document ID.

## Local Development

Requires Node.js 22 or later. From the repository root:

```powershell
npm ci --prefix app
npm start --prefix app
```

Open http://localhost:3000. Set `PORT` to use another port. Local development writes to ignored `app/.data/store.json`. Local storage is deliberately forbidden in production. No demo members or fabricated events are seeded.

```powershell
npm run check --prefix app
npm test --prefix app
```

Tests cover public pages, identity validation, password verification, role isolation, CSRF, registration and review, inquiry resolution, session revocation, and optimistic concurrency.

## Azure Resources

The infrastructure is defined in [infra/main.bicep](infra/main.bicep).

| Resource | Name / Configuration |
| --- | --- |
| Resource group | GlobalAIManila |
| Region | Southeast Asia |
| App Service plan | GlobalAIManilaPlan, Linux Basic B1, Always On enabled |
| Web app | GlobalAIManilaWebApp, Node.js 22 LTS |
| Cosmos account | globalaimaniladb (Azure requires lowercase account names) |
| Database | GlobalAIManilaDB |
| Throughput | 400 RU/s shared across all five containers |
| Containers | events, registrations, profiles, inquiries, sessions |
| GitHub identity | GlobalAIManilaGitHub |

Website: https://globalaimanilawebapp.azurewebsites.net

`GET /health` performs a Cosmos query and returns `{"status":"ok","storage":"cosmos"}` when the deployed database connection is healthy. It returns HTTP 503 when storage is unavailable.

Cosmos keys are disabled. The app uses its system-assigned managed identity with Cosmos DB Built-in Data Contributor, scoped to this database. The deployment operator also receives database-scoped data access for administrator management. GitHub uses a separate identity with Website Contributor only on this web app. Its OIDC federation trusts only `repo:zzulueta/vscodedemo:ref:refs/heads/main`.

### Cost And Availability

Basic B1 is the lowest Basic App Service size, selected to avoid F1's daily CPU quota after free-tier interruptions. It uses paid dedicated compute with Always On enabled. Hosting charges continue while the plan exists, even if the web app is stopped. Review regional pricing and set a cost budget; deployment slots are not included.

Cosmos DB free tier includes 1,000 RU/s and 25 GB for one eligible account per subscription. This deployment uses one region, 400 shared RU/s, local periodic backup storage, and a 1,000 RU/s account cap. Storage over 25 GB, other Azure usage, or later configuration changes can incur charges. The cap limits throughput, not storage costs. Set spending alerts in Azure Cost Management before opening the site to substantial traffic.

Cosmos uses a public TLS endpoint protected by Entra authorization with key authentication disabled. Private networking is not configured; moving to it requires a pricing and architecture review.

### First Administrator

1. Create your own profile on the live website. No default administrator or shared password exists.
2. In your Azure-authenticated terminal, set the Cosmos endpoint and run the role utility with the email you registered. Verify account ownership before promoting anyone; signup does not verify email ownership.

```powershell
$env:COSMOS_ENDPOINT = 'https://globalaimaniladb.documents.azure.com:443/'
$env:COSMOS_DATABASE = 'GlobalAIManilaDB'
npm run admin --prefix app -- your-email@example.com admin
```

3. Sign in again. Open `/admin` for registrations and inquiries, or `/events#create-event` to publish events. Event dates are entered in Manila time (UTC+08:00).

Use the same utility with `member` to revoke administrator access. Role changes invalidate existing sessions. The local-development equivalent omits the Cosmos environment variables.

There is no outbound email service or self-service password-reset flow configured. Registration decisions appear in the member profile. Organizers reply to inquiries using their email client. Account assistance and data removal requests go to the organizers through Contact Us; database changes require an authorized operator. Add verified-email recovery and a transactional email provider before relying on email-based identity or automated notifications.

### Provision Or Update Infrastructure

The operator needs resource-creation, role-assignment, and Cosmos data-role-management permissions in the target subscription. Use an existing Azure CLI sign-in:

```powershell
az group create --name GlobalAIManila --location southeastasia
$operatorId = az ad signed-in-user show --query id -o tsv
az deployment group validate --resource-group GlobalAIManila --template-file infra/main.bicep --parameters "operatorPrincipalId=$operatorId"
az deployment group what-if --resource-group GlobalAIManila --template-file infra/main.bicep --parameters "operatorPrincipalId=$operatorId"
az deployment group create --name global-ai-manila --resource-group GlobalAIManila --template-file infra/main.bicep --parameters "operatorPrincipalId=$operatorId"
```

The template explicitly provisions paid Basic B1 hosting and free-tier Cosmos DB. It does not silently change the Cosmos pricing configuration or rename resources if free-tier eligibility or global names are unavailable.

### Deploy From This Machine

```powershell
./scripts/package.ps1
az webapp deploy --resource-group GlobalAIManila --name GlobalAIManilaWebApp --src-path .deployment/website.zip --type zip
```

The archive contains the app, production dependencies, and logo. It excludes local data, environment files, tests, and the Git directory. Azure runs `cd /home/site/wwwroot/app && node server.js`.

## GitHub Actions

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs syntax checks, tests, and a production dependency audit. Pushes to `main` also package and deploy the application, then check its live database health. Pull requests run checks without receiving deployment credentials.

The connected repository is https://github.com/zzulueta/vscodedemo. Configure these repository **variables**, not secrets, from the Bicep deployment outputs:

- `AZURE_CLIENT_ID`: GitHub managed identity client ID.
- `AZURE_TENANT_ID`: Azure tenant ID.
- `AZURE_SUBSCRIPTION_ID`: target subscription ID.
- `AZURE_WEBSITE_URL`: deployed HTTPS URL.

No publish profile, database key, service-principal password, or GitHub token belongs in this repository. The identity identifiers are not credentials; GitHub obtains a short-lived OIDC token when an authorized workflow runs.

The source and workflow must be committed and pushed to `main` before automatic deployment can run. Infrastructure changes are applied separately by an authorized operator; the GitHub identity cannot change Cosmos resources or role assignments.

## References

- [Cosmos DB free tier](https://learn.microsoft.com/azure/cosmos-db/free-tier)
- [Cosmos DB Bicep examples](https://learn.microsoft.com/azure/cosmos-db/manage-with-bicep)
- [App Service GitHub Actions and OIDC](https://learn.microsoft.com/azure/app-service/deploy-github-actions)
- [Asset attribution and licensing](ATTRIBUTIONS.md)