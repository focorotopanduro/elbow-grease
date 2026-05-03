# Hostinger Release Checklist

This site builds as static files, so Hostinger can host the public marketing site by uploading the contents of `dist/` into `public_html/`.

## What I need from you at deployment time

- Hostinger account access on your machine, or a screen share where you stay logged in.
- The domain you want live, likely `beitbuilding.com` and whether `www.beitbuilding.com` should redirect to it or the other way around.
- Current DNS situation: whether Hostinger nameservers are active, or whether the domain still points to Vercel.
- The production form key values: `VITE_WEB3FORMS_KEY`, `VITE_BUSINESS_PHONE`, `VITE_BUSINESS_EMAIL`, `VITE_BUSINESS_WHATSAPP`, and optional `VITE_ZOOM_URL`.
- Whether we still need Vercel server features for `/api/leads`, lead email, KV storage, cron cleanup, Slack, or Discord. Hostinger static hosting will not run those Vercel API functions.

## Build locally

```bash
npm.cmd test
npm.cmd run lint
npm.cmd run audit:security
npm.cmd run check:nap
npm.cmd run build
npm.cmd run audit:static
npm.cmd run verify:release
```

Upload everything inside:

```text
C:\BEITBUILDING\website\dist
```

Do not upload the project root. The root contains source files, docs, local screenshots, and backups that do not belong on the public server.

For the easiest handoff, run:

```bash
npm.cmd run release:hostinger
```

That prepares:

- `release/hostinger-upload/` — upload the contents of this folder.
- `release/beitbuilding-hostinger-upload.zip` — same package as a zip when local zip tooling is available.
- `release/HOSTINGER_UPLOAD_README.txt` — local upload notes; this file is outside the public upload package.
- `release/RELEASE_MANIFEST.json` — local file list, sizes, route list, and SHA-256 checksums for upload verification.

`npm.cmd run release:hostinger` runs lint, security audit, tests, NAP audit, build, static dist audit, release verification, and package creation in one command.

## Hostinger upload path

In Hostinger File Manager, open the domain's `public_html/` folder. Delete or archive the old site files, then upload the contents of `dist/`.

The build includes `.htaccess`, which provides:

- Clean URL routing, so `/orlando-roofing` serves `/orlando-roofing.html`.
- A fallback to `index.html` for unknown app routes.
- A real 404 for `/api/*`, so static Hostinger hosting never pretends a Vercel lead endpoint accepted a form submission.
- Security headers comparable to the former Vercel setup.
- Cache rules for hashed build assets and no-cache rules for HTML/service worker files.

## After upload

- Visit `https://beitbuilding.com/`.
- Test `/orlando-roofing`, `/winter-park-roofing`, `/oviedo-roofing`, and `/oviedo-storm-damage`.
- Submit a test lead using your own contact details.
- Verify the lead arrives through the configured destination.
- Check mobile layout and the sticky CTA.

## GitHub-backed release option

If this project is pushed to GitHub, use the artifact workflow first:

```text
.github/workflows/release-artifact.yml
```

It runs the same tests and Hostinger packaging command locally documented above, then uploads a downloadable release artifact for manual Hostinger upload.

The optional manual deploy workflow is:

```text
.github/workflows/hostinger-manual-deploy.yml
```

Use that only after Hostinger FTP secrets, production form settings, the `production` GitHub environment, and the final `public_html/` target have been confirmed. See `docs/github-release-automation.md` and `docs/hostinger-github-setup-guide.md`.

## Vercel vs Hostinger decision

Pure Hostinger hosting is enough for the public website if Web3Forms or mailto handles leads.

Keep Vercel in the stack if you want the richer backend:

- `/api/leads`
- Resend/SendGrid operations email
- KV lead archive
- Slack/Discord webhooks
- Cron cleanup
- Health endpoint

In that hybrid setup, Hostinger usually manages DNS while the domain points to Vercel. In pure Hostinger setup, the domain points to Hostinger and the site is just the uploaded `dist/` folder.
