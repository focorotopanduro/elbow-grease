# Releasing ELBOW GREASE

This project ships **hands-off**: after a one-time setup, every release
takes one command and the users' installed copies auto-update themselves.
You never run `tauri build` locally or attach installers by hand.

```
dev machine                     GitHub                        user's PC
──────────                      ──────                        ─────────
 npm run release:patch  ──────▶  tag push triggers CI
                                 └─ Windows runner builds
                                    .msi + .exe + signatures
                                    + latest.json manifest
                                 └─ Release published
                                                          ◀──── app boots
                                                              fetches latest.json
                                                              sees new version
                                                              downloads installer
                                                              verifies signature
                                                              installs + relaunches
```

---

## One-time setup (do this once per project)

### 1. Initialise git and push to GitHub

```sh
cd "/c/Program Files/ELBOW GREASE"
git init
git add .
git commit -m "Initial commit"
gh repo create beitbuilding/elbow-grease --private --source=. --push
```

> Adjust the owner/name — whatever you pick must also appear in
> `src-tauri/tauri.conf.json` under `plugins.updater.endpoints`.

### 2. Generate the Tauri signing keypair

The auto-updater refuses to install any bundle that isn't signed with
this key — that's what stops a MITM attacker from pushing a trojan
installer. Generate it **once** on your workstation:

```sh
# Install the CLI if you haven't
npm i -D @tauri-apps/cli

# Interactive — asks for an output path and a password.
# Recommended path:  %USERPROFILE%/.tauri/elbow-grease.key
# Set a password you can paste into GitHub Secrets below.
npx tauri signer generate -w "$HOME/.tauri/elbow-grease.key"
```

This produces two files:

| File | Role | Where it goes |
|---|---|---|
| `elbow-grease.key`      | **private** | Never commit. Stays on your machine + GitHub Secrets. |
| `elbow-grease.key.pub`  | public      | Paste into `tauri.conf.json` → `plugins.updater.pubkey`. |

### 3. Publish the public key

Copy the contents of `elbow-grease.key.pub` and paste it as the
`pubkey` value in `src-tauri/tauri.conf.json`:

```jsonc
"plugins": {
  "updater": {
    "endpoints": ["https://github.com/<owner>/<repo>/releases/latest/download/latest.json"],
    "dialog": false,
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6RjdGN0E0Q0Y4NEI4...etc..."
  }
}
```

Commit and push.

### 4. Add GitHub repository secrets

In the repo's **Settings → Secrets and variables → Actions → New repository secret**, add:

| Secret name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`          | The full contents of `elbow-grease.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you set during generation  |

> The default `GITHUB_TOKEN` is already provided by Actions — no need to add one.

Setup is now complete. You'll never touch any of the above again unless
you rotate keys or move the repo.

---

## Cutting a release (every time)

From the project root:

```sh
npm run release:patch    # 0.1.0 → 0.1.1  (bugfix)
# or
npm run release:minor    # 0.1.0 → 0.2.0  (new feature)
# or
npm run release:major    # 0.1.0 → 1.0.0  (breaking)
```

What happens:

1. `tools/bump-version.mjs` updates the version string in all three
   places that Tauri, npm, and Cargo each track independently:
   `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
2. `tools/push-tag.mjs` commits the bump, creates a `vX.Y.Z` annotated
   tag, and pushes it.
3. GitHub Actions' **Release** workflow (`.github/workflows/release.yml`)
   fires. It builds the Windows bundles, signs them with the private
   key, generates `latest.json`, and attaches everything to a fresh
   GitHub Release. Typical runtime: 8–12 minutes.
4. Every installed copy of the app polls `latest.json` on launch (and
   every 6 hours while running). When the version there is newer than
   the one running, the user sees a toast in the bottom-right corner
   saying "Install & restart". Click → done.

### If the working tree is dirty

`push-tag.mjs` refuses to tag if there are uncommitted changes beyond
the three version files. Commit or stash first.

### Pushing a hotfix for an exact version

```sh
node tools/bump-version.mjs 0.1.7   # sets exact version
npm run release:tag                  # commit + tag + push
```

### Re-running a failed release build

Go to the Actions tab → find the failed run → "Re-run failed jobs".
The tag already exists so no bump is needed.

### Triggering a build without bumping (for testing the workflow itself)

Actions tab → Release workflow → Run workflow → optionally supply a
version override.

---

## How the signature check works

The updater plugin embeds the public key you pasted into
`tauri.conf.json` at compile time. On update:

1. It fetches `latest.json` and finds the `signature` field for this
   platform.
2. It downloads the installer binary.
3. It verifies the installer's hash against the signature using the
   embedded pubkey.
4. Only on success does it hand the binary to the OS installer.

A mismatch (wrong key, tampered binary, corrupt download) raises an
error that lands in the update modal. Nothing is installed.

---

## Rotating the signing key

Rare, but:

1. Generate a new key (step 2 above).
2. Replace `pubkey` in `tauri.conf.json`.
3. Replace the GitHub Secrets.
4. Cut a new release.

**Important:** apps signed with the OLD key cannot auto-update to
installers signed with the NEW one. Existing users will need to
reinstall manually from the GitHub Release page *once*. Plan rotations
for a major-version boundary if at all possible.

---

## Local smoke-testing the updater before shipping

1. Check out the previous release tag (`git checkout v0.1.0`).
2. `npm run tauri:build` → install the produced NSIS installer.
3. Launch the installed app. Leave it open.
4. Back in your source tree, `npm run release:patch` and wait for CI to
   finish.
5. The running app should show the update toast within 6h — or restart
   it to trigger an immediate boot check.
