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

// buildPath supplies the dependency list to walk; projectRootPath bounds how
// far up the tree the module search may climb. Both are needed here:
// .npmrc pins node-linker=hoisted, so the native modules (better-sqlite3,
// onnxruntime-node) are physically installed at the WORKSPACE ROOT while the
// package.json that declares them is in apps/desktop. Without projectRootPath
// the search never left apps/desktop/node_modules — which holds no native
// modules at all — so @electron/rebuild found nothing, rebuilt nothing, and
// exited 0 in under a second. The .node binaries kept whatever ABI npm had
// built them with (Node 20 / ABI 115) and `pnpm dev` died on require with
// "compiled against a different Node.js version". Packaged builds hid this
// because electron-builder runs its own rebuild against the target Electron.
const buildPath = path.resolve(import.meta.dirname, "..");
const projectRootPath = path.resolve(import.meta.dirname, "..", "..", "..");
const arch = process.env.npm_config_arch ?? process.arch;

console.log(`rebuild-native-for-electron: rebuilding for electron@${electronVersion} ${process.platform}-${arch}`);

const rebuilt = [];
const runner = rebuild({
  buildPath,
  projectRootPath,
  electronVersion,
  arch,
  force: true
});
runner.lifecycle.on("module-done", (name) => rebuilt.push(name));
await runner;

// A silent no-op is the exact failure this script existed to prevent, and it
// looks identical to success. Fail loudly instead.
if (rebuilt.length === 0) {
  console.error(
    "rebuild-native-for-electron: FAIL — walked the tree and rebuilt zero native modules.\n" +
      `  buildPath:       ${buildPath}\n` +
      `  projectRootPath: ${projectRootPath}\n` +
      "  Native modules are hoisted to the workspace root; if this suddenly finds\n" +
      "  nothing, check that .npmrc still sets node-linker=hoisted."
  );
  process.exit(1);
}

console.log(`rebuild-native-for-electron: done (${rebuilt.length}: ${rebuilt.join(", ")})`);
