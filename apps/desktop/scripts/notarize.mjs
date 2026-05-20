import path from "node:path";
import process from "node:process";
import { notarize } from "@electron/notarize";

export default async function notarizeApp(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== "darwin") {
    return;
  }

  if (process.env.ARCHI_SKIP_NOTARIZE === "1") {
    console.log("Skipping notarization (ARCHI_SKIP_NOTARIZE=1).");
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log("Skipping notarization (missing APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID).");
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath} with Apple notary service as ${appleId} (team ${teamId})...`);
  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId
  });
}
