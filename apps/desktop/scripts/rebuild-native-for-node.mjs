import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// Counterpart to rebuild-native-for-electron.mjs.
//
// A native module can only be built for ONE ABI at a time, and Electron's is
// not Node's (Electron 43 = ABI 148, Node 20 = ABI 115). `pnpm dev` needs the
// Electron build; vitest and `pnpm typecheck` run under plain Node and need the
// Node build. Whichever ran last wins, so switching back has to be a real
// command rather than folklore.
//
// Only better-sqlite3 matters here. sharp also gets rebuilt for Electron, but
// it arrives as a transitive dep of @xenova/transformers and no source file
// imports it, so its ABI never affects the Node-side test run.
const projectRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const modulePath = path.join(projectRoot, "node_modules", "better-sqlite3");

if (!fs.existsSync(modulePath)) {
  console.error(`rebuild-native-for-node: better-sqlite3 not found at ${modulePath}; run pnpm install first.`);
  process.exit(1);
}

// `node-gyp rebuild` alone is not enough: make sees the Electron-built object
// files as up to date and does nothing but re-stamp them, leaving the wrong
// ABI in place. clean + force_build is what actually recompiles.
console.log(`rebuild-native-for-node: rebuilding better-sqlite3 for node@${process.versions.node} (ABI ${process.versions.modules})`);
for (const args of [["clean"], ["rebuild", "--release", "--force_build=1"]]) {
  const result = spawnSync("node-gyp", args, { cwd: modulePath, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`rebuild-native-for-node: node-gyp ${args[0]} failed with status ${result.status}`);
    process.exit(1);
  }
}

console.log("rebuild-native-for-node: done");
