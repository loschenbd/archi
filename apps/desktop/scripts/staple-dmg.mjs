import { execFileSync } from "node:child_process";
import process from "node:process";
import { notarize } from "@electron/notarize";

export default async function notarizeAndStapleDmgs(context) {
  if (process.platform !== "darwin") {
    return;
  }

  if (process.env.ARCHI_SKIP_NOTARIZE === "1") {
    console.log("Skipping DMG notarization (ARCHI_SKIP_NOTARIZE=1).");
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log("Skipping DMG notarization (missing APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID).");
    return;
  }

  const dmgs = (context.artifactPaths ?? []).filter((p) => p.endsWith(".dmg"));
  if (dmgs.length === 0) {
    return;
  }

  for (const dmg of dmgs) {
    console.log(`Notarizing DMG ${dmg} with Apple notary service...`);
    await notarize({
      appPath: dmg,
      appleId,
      appleIdPassword,
      teamId
    });
    console.log(`Stapling notarization ticket to ${dmg}...`);
    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
  }
}
