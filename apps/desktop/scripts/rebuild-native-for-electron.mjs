import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
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

const betterSqlitePath = path.dirname(require.resolve("better-sqlite3/package.json"));
const prebuildInstall = path.join(betterSqlitePath, "node_modules", ".bin", "prebuild-install");

if (!existsSync(prebuildInstall)) {
  console.error(
    `rebuild-native-for-electron: prebuild-install not found at ${prebuildInstall}. ` +
      "Confirm better-sqlite3 dependencies are installed and that pnpm allows install scripts (root package.json -> pnpm.onlyBuiltDependencies)."
  );
  process.exit(1);
}

const arch = process.env.npm_config_arch ?? process.arch;
const platform = process.env.npm_config_platform ?? process.platform;

console.log(
  `rebuild-native-for-electron: fetching better-sqlite3 prebuild for electron@${electronVersion} ${platform}-${arch}`
);

const result = spawnSync(
  prebuildInstall,
  ["--runtime=electron", `--target=${electronVersion}`, `--arch=${arch}`, `--platform=${platform}`],
  {
    cwd: betterSqlitePath,
    stdio: "inherit"
  }
);

if (result.status !== 0) {
  console.error(
    `rebuild-native-for-electron: prebuild-install exited with code ${result.status}. ` +
      "Run apps/desktop/scripts/rebuild-native-for-electron.mjs manually to retry."
  );
  process.exit(result.status ?? 1);
}
