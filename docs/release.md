# Releasing Archi (desktop)

This doc captures what's required to ship a Gatekeeper-clean macOS DMG.

## TL;DR

A "good" release of `apps/desktop` must pass `pnpm verify:signing`, which
asserts:

- the `.app` is signed with `Developer ID Application: Benjamin Loschen
  (74KV536J36)` with hardened runtime enabled,
- the `.app` is **notarized** and has a stapled notarization ticket,
- the DMG has a stapled notarization ticket,
- `spctl --assess --type install` accepts the DMG, and
- `spctl --assess --type execute` reports `source=Notarized Developer ID`
  on the `.app`.

If any of those fail, users see "Apple cannot check it for malicious
software" on first open. The `release` npm script runs `verify-signing`
as a final step so a regression cannot ship.

## Why this doc exists

`v0.2.0` shipped signed-but-not-notarized. The notarize-creds config
change (commit `286b5a6`) landed *after* the tag, so the local
`pnpm release` ran without notarize credentials and silently produced an
unnotarized DMG. Don't repeat this.

## Prerequisite — notarize credentials in env vars (local builds)

The Apple ID password used here must be an **app-specific password**
generated at https://appleid.apple.com/account/manage > Sign-In and
Security > App-Specific Passwords. Do **not** use your regular Apple ID
password.

electron-builder 24+ does not support `keychainProfile` on `mac.notarize`,
so for local releases you must export the credentials in your shell
before running `pnpm release`:

```bash
export APPLE_ID="loschenbd@gmail.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="74KV536J36"
```

You can keep these in a per-shell secret store (1Password, Apple
Passwords) and paste before each release, or in a `~/.zshrc.local` that
isn't committed. Do **not** put them in `.envrc` or the repo.

Optional — store a notarytool keychain profile for ad-hoc submissions:

```bash
xcrun notarytool store-credentials archi-notarize \
  --apple-id "loschenbd@gmail.com" \
  --team-id 74KV536J36 \
  --password "<app-specific-password>"
xcrun notarytool history --keychain-profile archi-notarize
```

That profile is only useful if you call `xcrun notarytool submit`
directly — `pnpm release` ignores it.

## Prerequisite — Developer ID Application cert

```bash
security find-identity -v -p codesigning
```

Must list `Developer ID Application: Benjamin Loschen (74KV536J36)`.
This is a paid Apple Developer Program cert and must be in the login
keychain. If absent, request it from Apple Developer > Certificates and
import the `.p12`.

## Local release

```bash
cd apps/desktop
# bump version in apps/desktop/package.json
pnpm release
```

`release` runs `pnpm build`, then `electron-builder --publish always`
(which signs, notarizes, staples, and uploads to GitHub Releases),
then `verify-packaged-runtime.mjs`, then `verify-signing.mjs`. If
`verify-signing.mjs` fails, the release has shipped to GitHub but is
broken — delete the GH release assets and roll a patch version.

## CI release (preferred)

Pushing a tag matching `v*` triggers
`.github/workflows/desktop-release.yml`, which runs the same pipeline on
a hosted macOS runner with credentials from GH Actions secrets. See
[Secrets the release workflow needs](#secrets-the-release-workflow-needs)
below.

```bash
cd apps/desktop
# bump version in apps/desktop/package.json, commit, then:
git tag v0.2.1
git push origin v0.2.1
```

## Manual verification on a shipped DMG

```bash
DMG=$(curl -sL -o /tmp/Archi-arm64.dmg \
  https://github.com/loschenbd/archi/releases/latest/download/Archi-arm64.dmg \
  && echo /tmp/Archi-arm64.dmg)
spctl --assess --type install -vvv "$DMG"      # expect "accepted"
stapler validate "$DMG"                         # expect "worked"
hdiutil attach -nobrowse -mountpoint /tmp/m "$DMG"
spctl --assess --type execute -vvv /tmp/m/Archi.app   # expect "Notarized Developer ID"
stapler validate /tmp/m/Archi.app
hdiutil detach /tmp/m
```

## Secrets the release workflow needs

Set these in GitHub > Settings > Secrets and variables > Actions > Repository secrets:

| Secret | What it is | How to generate |
| --- | --- | --- |
| `MAC_CERT_P12_BASE64` | base64-encoded `.p12` export of the Developer ID Application cert + private key | Keychain Access > export the cert as `.p12` with a strong password, then `base64 -i cert.p12 \| pbcopy` |
| `MAC_CERT_PASSWORD` | the password you set when exporting the `.p12` | — |
| `KEYCHAIN_PASSWORD` | any random string; used to lock/unlock the temp keychain in CI | `openssl rand -hex 32` |
| `APPLE_ID` | your Apple ID email | — |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password | https://appleid.apple.com > Sign-In and Security > App-Specific Passwords |
| `APPLE_TEAM_ID` | `74KV536J36` | — |

In CI, `electron-builder` reads `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
and `APPLE_TEAM_ID` directly from env (preferred over the local
`keychainProfile` path). The workflow imports the cert into a temp
keychain at the start and deletes it at the end so the runner stays
clean.
