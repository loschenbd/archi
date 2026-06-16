// electron-builder hook: notarize + staple any .dmg artifact AFTER it is built
// but BEFORE publishing. Necessary because electron-builder's mac.notarize config
// only notarizes the .app, not the DMG container — and on macOS Sequoia+ the DMG
// also needs its own stapled notarization ticket for `spctl --assess --type install`
// to accept it on download.
//
// Triggered automatically by electron-builder.yml's `afterAllArtifactBuild:` field.
//
// Reads creds from env: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.

const { spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function afterAllArtifactBuild(buildResult) {
  const APPLE_ID = process.env.APPLE_ID;
  const APPLE_APP_SPECIFIC_PASSWORD = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;

  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    throw new Error(
      "[afterAllArtifactBuild] missing required env vars. " +
        "Need APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID for DMG notarization.",
    );
  }

  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith(".dmg"));
  if (dmgs.length === 0) {
    console.log("[afterAllArtifactBuild] no .dmg artifacts to notarize");
    return [];
  }

  for (const dmg of dmgs) {
    const name = path.basename(dmg);
    console.log(`[afterAllArtifactBuild] submitting ${name} to Apple notarization (1-3 min)...`);

    const submit = spawnSync(
      "xcrun",
      [
        "notarytool",
        "submit",
        dmg,
        "--apple-id",
        APPLE_ID,
        "--password",
        APPLE_APP_SPECIFIC_PASSWORD,
        "--team-id",
        APPLE_TEAM_ID,
        "--wait",
      ],
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
