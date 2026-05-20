import { rebuild } from "@electron/rebuild";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const desktopPackagePath = path.resolve(import.meta.dirname, "..", "package.json");
const require = createRequire(import.meta.url);
const desktopPkg = require(desktopPackagePath);

const electronVersionSpec = desktopPkg.devDependencies?.electron ?? desktopPkg.dependencies?.electron;
if (!electronVersionSpec) {
  console.error("rebuild-native-for-electron: electron is not listed in apps/desktop dependencies; aborting.");
  process.exit(1);
}
const electronVersion = electronVersionSpec.replace(/^[~^]/, "");

const buildPath = path.resolve(import.meta.dirname, "..");
const arch = process.env.npm_config_arch ?? process.arch;

console.log(`rebuild-native-for-electron: rebuilding for electron@${electronVersion} ${process.platform}-${arch}`);

await rebuild({
  buildPath,
  electronVersion,
  arch,
  force: true
});

console.log("rebuild-native-for-electron: done");
