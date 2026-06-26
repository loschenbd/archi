// electron-builder afterSign hook: notarize + staple the signed .app.
//
// Replaces electron-builder's built-in `mac.notarize` (removed from
// electron-builder.yml) because that path only accepts Apple-ID env creds —
// electron-builder 24.x cannot use a local `notarytool` keychain profile.
// @electron/notarize CAN, so we drive it here: it zips the .app, submits to
// notarytool, waits, and staples the ticket onto the .app on success.
//
// The DMG container is notarized + stapled separately in afterAllArtifactBuild
// (notarytool requires the .app to be wrapped in a zip/dmg/pkg — it cannot
// submit a bare .app — and the DMG needs its own staple for Gatekeeper on
// download).

const path = require("node:path");
const notaryCredentials = require("./notary-credentials.cjs");

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  if (process.env.SKIP_NOTARIZE === "1") {
    console.log("[afterSign] SKIP_NOTARIZE=1 — skipping .app notarization");
    return;
  }

  const appName = context.packager.appInfo.productFilename; // "Archi"
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  const creds = notaryCredentials();
  const opts =
    creds.kind === "apple-id"
      ? {
          appPath,
          tool: "notarytool",
          appleId: creds.appleId,
          appleIdPassword: creds.appleIdPassword,
          teamId: creds.teamId,
        }
      : { appPath, tool: "notarytool", keychainProfile: creds.keychainProfile };

  console.log(
    `[afterSign] notarizing ${appName}.app via ${creds.kind}` +
      (creds.kind === "keychain-profile" ? ` "${creds.keychainProfile}"` : "") +
      " (2-5 min)...",
  );

  // Lazy require so non-darwin / SKIP_NOTARIZE paths don't need the dep.
  const { notarize } = require("@electron/notarize");
  await notarize(opts);

  console.log(`[afterSign] OK: ${appName}.app notarized + stapled`);
};
