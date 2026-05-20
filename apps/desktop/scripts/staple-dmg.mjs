import { execFileSync } from "node:child_process";
import process from "node:process";

export default async function stapleDmgs(context) {
  if (process.platform !== "darwin") {
    return;
  }

  const notarized = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
  if (!notarized) {
    console.log("Skipping DMG stapling (notarization env vars not set).");
    return;
  }

  const dmgs = (context.artifactPaths ?? []).filter((p) => p.endsWith(".dmg"));
  if (dmgs.length === 0) {
    return;
  }

  for (const dmg of dmgs) {
    console.log(`Stapling notarization ticket to ${dmg}...`);
    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
  }
}
