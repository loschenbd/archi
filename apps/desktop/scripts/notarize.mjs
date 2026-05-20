import path from "node:path";
import process from "node:process";
import { notarize } from "@electron/notarize";

const KEYCHAIN_PROFILE = "archi-notarize";

export default async function notarizeApp(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== "darwin") {
    return;
  }

  if (process.env.ARCHI_SKIP_NOTARIZE === "1") {
    console.log("Skipping notarization (ARCHI_SKIP_NOTARIZE=1).");
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath} via keychain profile "${KEYCHAIN_PROFILE}"...`);
  await notarize({ appPath, keychainProfile: KEYCHAIN_PROFILE });
}
