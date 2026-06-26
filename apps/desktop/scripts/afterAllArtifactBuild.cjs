// electron-builder hook: notarize + staple any .dmg artifact AFTER it is built
// but BEFORE publishing. Necessary because the .app notarization (afterSign hook)
// only covers the app, not the DMG container — and on macOS Sequoia+ the DMG
// also needs its own stapled notarization ticket for `spctl --assess --type install`
// to accept it on download.
//
// Triggered automatically by electron-builder.yml's `afterAllArtifactBuild:` field.
//
// Credentials: Apple-ID env vars (CI) or a local `notarytool` keychain profile —
// see notary-credentials.cjs. SKIP_NOTARIZE=1 bypasses (matches afterSign).

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const notaryCredentials = require("./notary-credentials.cjs");

module.exports = async function afterAllArtifactBuild(buildResult) {
  if (process.env.SKIP_NOTARIZE === "1") {
    console.log("[afterAllArtifactBuild] SKIP_NOTARIZE=1 — skipping DMG notarization");
    return [];
  }

  const creds = notaryCredentials();
  const credArgs =
    creds.kind === "apple-id"
      ? ["--apple-id", creds.appleId, "--password", creds.appleIdPassword, "--team-id", creds.teamId]
      : ["--keychain-profile", creds.keychainProfile];

  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith(".dmg"));
  if (dmgs.length === 0) {
    console.log("[afterAllArtifactBuild] no .dmg artifacts to notarize");
    return [];
  }

  for (const dmg of dmgs) {
    const name = path.basename(dmg);
    console.log(
      `[afterAllArtifactBuild] submitting ${name} to Apple notarization via ${creds.kind} (1-3 min)...`,
    );

    const submit = spawnSync(
      "xcrun",
      ["notarytool", "submit", dmg, ...credArgs, "--wait"],
      { stdio: ["ignore", "inherit", "inherit"] },
    );

    if (submit.status !== 0) {
      throw new Error(
        `[afterAllArtifactBuild] notarytool submit ${name} exited with status ${submit.status}`,
      );
    }

    console.log(`[afterAllArtifactBuild] stapling ticket to ${name}...`);
    const staple = spawnSync("xcrun", ["stapler", "staple", dmg], {
      stdio: ["ignore", "inherit", "inherit"],
    });

    if (staple.status !== 0) {
      throw new Error(`[afterAllArtifactBuild] stapler staple ${name} exited with status ${staple.status}`);
    }

    console.log(`[afterAllArtifactBuild] OK: ${name} notarized + stapled`);
  }

  // Return [] (no additional artifacts to publish — we mutated existing ones in place).
  return [];
};
