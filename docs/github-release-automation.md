# GitHub Release Automation

This project can be supported from a GitHub repository and turned into a repeatable release pipeline. The best production path for the current codebase is:

1. Push source changes to GitHub.
2. GitHub Actions runs `npm run release:vercel`.
3. Vercel automatically deploys production from `main`.
4. Hostinger keeps DNS/email or receives a verified static fallback package.

The local release commands stay authoritative so local releases and GitHub releases use the same gates.

## Recommended production approach

Use `.github/workflows/vercel-production-gate.yml` with Vercel's Git integration.

That workflow runs on pull requests, pushes to `main`, and manual dispatches. It installs dependencies with `npm ci`, then runs:

```bash
npm run release:vercel
```

That command performs the production dependency audit, lint, security audit, tests, NAP audit, production build, and Vercel-specific deployment audit. In GitHub branch protection, require this workflow before merging into `main`.

After the merge lands on `main`, Vercel's Git integration should create the production deployment.

Read `docs/vercel-production-setup.md` for the complete Vercel + Hostinger ownership split.

## Static fallback artifact

Use `.github/workflows/release-artifact.yml` first. It runs on pull requests, pushes to `main`, and manual dispatches. It installs dependencies with `npm ci`, runs `npm test`, runs `npm run release:hostinger`, then uploads:

- `release/hostinger-upload/`
- `release/beitbuilding-hostinger-upload.zip`
- `release/RELEASE_MANIFEST.json`
- `release/HOSTINGER_UPLOAD_README.txt`

That gives you a clean, downloadable release package without giving GitHub the power to edit the live Hostinger server.

## Optional one-click Hostinger deploy

When you are ready, use `.github/workflows/hostinger-manual-deploy.yml`. It is manual only and requires a checkbox confirmation. It builds the release from scratch, uploads the same artifact for audit history, then deploys `release/hostinger-upload/` to Hostinger by FTP.

Required GitHub repository secrets:

- `HOSTINGER_FTP_SERVER`
- `HOSTINGER_FTP_USERNAME`
- `HOSTINGER_FTP_PASSWORD`
- `VITE_WEB3FORMS_KEY`

Recommended GitHub repository variables:

- `HOSTINGER_FTP_SERVER_DIR` - usually `public_html/`
- `ADDITIONAL_ALLOWED_ORIGINS` - optional exact staging origins, comma-separated
- `VITE_BUSINESS_PHONE`
- `VITE_BUSINESS_EMAIL`
- `VITE_BUSINESS_WHATSAPP`
- `VITE_ZOOM_URL`

Use GitHub environments for an approval gate before production deploys. The workflow already targets the `production` environment so GitHub can require a manual reviewer before the FTP step runs.

## Other supported approaches

### Hostinger native Git deployment

Hostinger hPanel can connect a Git repository, branch, and install path. Its auto-deploy option can redeploy when commits land on the selected branch. This is simple, but it works best when the repository already contains the deployable static files or when the hosting plan can run the build exactly the way the project needs it. For this Vite site, that usually means either committing built files or using a Hostinger plan/runtime that can install Node dependencies and build.

### GitHub artifact, manual Hostinger upload

This is the most conservative route. GitHub proves that the site builds, tests, packages, and passes release verification. You download the zip from the workflow run and upload it into Hostinger `public_html/`.

### GitHub Actions direct FTP deploy

This is the fastest release route once credentials are configured. The manual deploy workflow uploads only the verified static package, not the source repository. Keep `dangerous-clean-slate` disabled unless you intentionally want GitHub to delete remote files that are not in the package.

### Vercel stays as production

If the Vercel backend matters, keep Vercel as the deployment target and use Hostinger for DNS/domain management. That keeps `/api/leads`, KV lead storage, Resend/SendGrid email, webhooks, cron jobs, and health checks alive.

### Hybrid static Hostinger plus Vercel API

Hostinger can serve the static front-end while Vercel serves API functions from a subdomain. This is possible, but it needs extra CSP, CORS, lead endpoint, and DNS configuration. Use it only if you specifically want Hostinger to serve the public files while Vercel keeps the backend.

## What I need to connect it

- GitHub repository owner/name and the production branch, usually `main`.
- Whether releases should be artifact-only, manual deploy, or automatic deploy after every `main` push.
- Hostinger FTP/FTPS hostname, username, password, and remote directory.
- The canonical domain decision: `beitbuilding.com` or `www.beitbuilding.com`.
- The production contact values and form keys listed above.
- A decision on whether Vercel API features remain part of production.

For the step-by-step credential, destination-folder, and approval setup, use `docs/hostinger-github-setup-guide.md`.
