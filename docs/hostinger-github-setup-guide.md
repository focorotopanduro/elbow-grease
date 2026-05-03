# Hostinger + GitHub Setup Guide

Use this when you are ready to connect the GitHub repository to the live Hostinger website.

Do not commit real passwords, API keys, or private credentials into this file. The names below are the names to create in GitHub; the values belong only in GitHub Secrets, GitHub Variables, Hostinger, or your password manager.

## 1. FTP credentials

FTP credentials let GitHub upload the verified static release files into Hostinger.

Recommended account:

```text
Purpose: GitHub production deploy for Beit Building
Hostinger FTP account label: beitbuilding-release
Allowed directory: /public_html
Protocol: FTP/FTPS
Port: 21
```

In Hostinger:

1. Open hPanel.
2. Go to Websites.
3. Choose the Beit Building website and open Dashboard.
4. Open FTP Accounts.
5. Prefer creating an additional FTP account for deployments.
6. Set the directory to `/public_html`.
7. Generate or set a strong password and store it in a password manager.

The GitHub secrets should be:

```text
HOSTINGER_FTP_SERVER=<Hostinger FTP IP or hostname>
HOSTINGER_FTP_USERNAME=<Hostinger FTP username>
HOSTINGER_FTP_PASSWORD=<Hostinger FTP password>
```

Meaning:

- `HOSTINGER_FTP_SERVER` is where GitHub connects.
- `HOSTINGER_FTP_USERNAME` identifies the deploy account.
- `HOSTINGER_FTP_PASSWORD` proves GitHub is allowed to upload.

## 2. Destination folder

The destination folder is the folder on Hostinger where website files go.

For a normal root-domain website, use:

```text
HOSTINGER_FTP_SERVER_DIR=public_html/
```

Meaning:

- `public_html/` is the public website root on Hostinger.
- Uploading to this folder makes `index.html`, `.htaccess`, images, CSS, and JS visible to visitors.
- Uploading above `public_html/` will not publish the site correctly.
- Uploading to the wrong subfolder can make the site appear broken or hidden.

Create this as a GitHub repository variable, not a secret:

```text
Name: HOSTINGER_FTP_SERVER_DIR
Value: public_html/
```

## 3. Production site variables

These configure public contact behavior in the built React site.

GitHub secret:

```text
VITE_WEB3FORMS_KEY=<production Web3Forms key>
```

GitHub variables:

```text
VITE_BUSINESS_PHONE=<public phone number>
VITE_BUSINESS_EMAIL=<public email address>
VITE_BUSINESS_WHATSAPP=<public WhatsApp phone/link value>
VITE_ZOOM_URL=<business Zoom scheduling link, optional>
ADDITIONAL_ALLOWED_ORIGINS=<exact staging origins, optional>
```

Use a secret for the form key because it authorizes form submissions. Use variables for public business contact details because they are displayed or embedded in the public site anyway.

## 4. Approval behavior

Approval behavior controls whether GitHub is allowed to deploy immediately or must wait for a human.

The workflow already uses:

```text
environment: production
```

In GitHub:

1. Open the repository.
2. Go to Settings.
3. Open Environments.
4. Create an environment named `production`.
5. Enable required reviewers.
6. Add yourself or the trusted release owner as the reviewer.
7. Restrict deployment branches to `main`.
8. Optional: add a short wait timer if you want a pause before live deployment.

Recommended behavior for this site:

```text
Artifact workflow: automatic on pull request and main push
Production deploy workflow: manual only
Production environment approval: required
Allowed production branch: main
```

This means GitHub can package releases freely, but it cannot publish to Hostinger unless someone intentionally starts and approves the deploy.

## 5. GitHub location for each value

Repository secrets:

```text
Settings -> Secrets and variables -> Actions -> Secrets
```

Add:

```text
HOSTINGER_FTP_SERVER
HOSTINGER_FTP_USERNAME
HOSTINGER_FTP_PASSWORD
VITE_WEB3FORMS_KEY
```

Repository variables:

```text
Settings -> Secrets and variables -> Actions -> Variables
```

Add:

```text
HOSTINGER_FTP_SERVER_DIR=public_html/
ADDITIONAL_ALLOWED_ORIGINS
VITE_BUSINESS_PHONE
VITE_BUSINESS_EMAIL
VITE_BUSINESS_WHATSAPP
VITE_ZOOM_URL
```

Environment approval:

```text
Settings -> Environments -> production
```

Set:

```text
Required reviewers: enabled
Deployment branches: selected branch, main
```

## 6. First safe release drill

1. Push the repository to GitHub.
2. Open Actions.
3. Run `Build Hostinger Release Artifact`.
4. Confirm it passes tests and uploads the artifact.
5. Download the artifact and inspect the zip.
6. Only after that, run `Deploy Hostinger Release`.
7. Confirm the `production` approval prompt appears.
8. Approve it.
9. Visit the live site and test the contact form.

## 7. What not to do

- Do not put real credentials into `.env`, README files, screenshots, or chat messages if avoidable.
- Do not use the main Hostinger account password as the deploy password if an additional restricted FTP account is available.
- Do not point `HOSTINGER_FTP_SERVER_DIR` outside `public_html/` unless Hostinger support or your hosting layout clearly requires it.
- Do not enable automatic deploy on every push until one or two manual deploys have worked cleanly.
