# Release setup checklist (pick up here)

One-time setup to make CI releases work, then the steady-state release cycle.
Companion to [docs/release.md](./release.md) — that's the reference; this is
the do-this-now checklist.

## Status as of 2026-06-15

- `v0.2.0` shipped signed-but-not-notarized → users hit Gatekeeper hard-reject.
- Local + CI release pipeline + `verify-signing.mjs` gate are merged
  (commit `6ad22d6`).
- Need to: add CI secrets, dry-run the workflow, then ship `v0.2.1`.

---

## STEP 1 — Generate an app-specific Apple ID password (one-time)

1. Go to <https://appleid.apple.com/account/manage>
2. Sign-In and Security → **App-Specific Passwords** → "+"
3. Label it `archi-notarize`
4. **Copy the password (format `xxxx-xxxx-xxxx-xxxx`) — Apple won't show it
   again.** Save it somewhere.

## STEP 2 — Export the Developer ID cert as a `.p12`

1. Open **Keychain Access**.
2. Search for `Developer ID Application: Benjamin Loschen`.
3. Right-click the cert → **Export "Developer ID Application: …"** → save as
   `archi-cert.p12` with a strong password.
4. **Save that password — that's `MAC_CERT_PASSWORD`.**
5. Base64-encode it for the GH secret:

```bash
base64 -i ~/Downloads/archi-cert.p12 | pbcopy
```

The base64 string is now on your clipboard.

## STEP 3 — Add the 6 GitHub Actions secrets

Go to <https://github.com/loschenbd/archi/settings/secrets/actions> →
"New repository secret" for each:

| Name | Value |
|---|---|
| `MAC_CERT_P12_BASE64` | paste from clipboard (step 2.5) |
| `MAC_CERT_PASSWORD` | the .p12 password from step 2.4 |
| `KEYCHAIN_PASSWORD` | run `openssl rand -hex 32` and paste |
| `APPLE_ID` | `ben@benjaminloschen.com` |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password from step 1 |
| `APPLE_TEAM_ID` | `74KV536J36` |

## STEP 4 — Dry-run the pipeline (no GH Release touched)

```bash
gh workflow run "Release Desktop" -f dry_run=true
gh run watch
```

Expected: ~10–15 min. On success the DMG appears as a downloadable workflow
artifact named `archi-dmg-dry-run`. Download it and sanity-check locally:

```bash
unzip -d /tmp/archi-dry ~/Downloads/archi-dmg-dry-run.zip
spctl --assess --type install -vvv /tmp/archi-dry/Archi-arm64.dmg
# must print: accepted
stapler validate /tmp/archi-dry/Archi-arm64.dmg
# must print: The validate action worked!
```

If it fails, the workflow log will name the broken step. Common causes:

- `missing X secret` → a STEP 3 secret is wrong or missing.
- `notarytool ... Invalid credentials` → the app-specific password from STEP 1
  was rejected; regenerate it and update the secret.
- `security import` fails → the `MAC_CERT_PASSWORD` doesn't match the `.p12`.

## STEP 5 — Once dry-run is green, ship v0.2.1

```bash
cd /Users/benjaminloschen/Projects/archi

# bump version
sed -i '' 's/"version": "0.2.0"/"version": "0.2.1"/' apps/desktop/package.json
git add apps/desktop/package.json
git commit -m "desktop: bump version to 0.2.1"
git push origin main

# tag — triggers the real release workflow
git tag v0.2.1
git push origin v0.2.1
gh run watch
```

The workflow runs `pnpm release` which signs, notarizes, staples, runs
`verify-signing.mjs`, then publishes the DMG + `latest-mac.yml` to a new
`v0.2.1` GitHub Release.

## STEP 6 — Verify what users will actually get

```bash
curl -sL -o /tmp/archi.dmg \
  https://github.com/loschenbd/archi/releases/latest/download/Archi-arm64.dmg
spctl --assess --type install -vvv /tmp/archi.dmg
# must print: accepted
stapler validate /tmp/archi.dmg
# must print: The validate action worked!
```

If both pass, Gatekeeper will open the DMG cleanly for any user on download.
You can also confirm visually: download the DMG in Safari, double-click — no
"Apple cannot check it for malicious software" warning, no "damaged" error.

---

## Fallback — laptop release (if CI isn't an option right now)

```bash
# one-time
xcrun notarytool store-credentials archi-notarize \
  --apple-id ben@benjaminloschen.com \
  --team-id 74KV536J36 \
  --password <app-specific-password>

# verify the profile exists (this is the check the original v0.2.0 release missed)
xcrun notarytool history --keychain-profile archi-notarize
# must NOT error with "No Keychain password item found"

# delete the broken v0.2.0 dmg asset first so electron-builder re-uploads
gh release delete-asset v0.2.0 Archi-arm64.dmg -y

# then ship
cd apps/desktop
sed -i '' 's/"version": "0.2.0"/"version": "0.2.1"/' package.json
pnpm release
```

Laptop release works but is fragile — keychain profile lives on one machine,
and the v0.2.0 trap is exactly what happens when that machine state drifts
from the config in the repo. CI is the preferred long-term path.

---

## Follow-ups (separate PRs, do when you want)

- **Universal/Intel build.** Currently arm64-only — non-arm64 Macs hitting
  the marketing site's download button silently get nothing usable. Either
  ship `--universal` or two arch DMGs + arch detection in the marketing site.
- **Confirm `latest-mac.yml` is uploaded.** `electron-updater` needs it. Check
  the v0.2.1 release assets list — should include `latest-mac.yml`,
  `latest-mac.yml.blockmap`, and `Archi-arm64.dmg.blockmap` alongside the DMG.
- **Auto-update smoke test.** Install v0.2.0, then publish v0.2.1, then open
  v0.2.0 — confirm it picks up the update.
