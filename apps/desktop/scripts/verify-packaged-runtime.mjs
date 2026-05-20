import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const releaseDir = path.resolve(process.cwd(), "release");
const candidateMacDirs = ["mac-arm64", "mac-x64", "mac-universal", "mac"];
const macDir = candidateMacDirs
  .map((name) => path.join(releaseDir, name))
  .find((dir) => fs.existsSync(path.join(dir, "Archi.app")));

if (!macDir) {
  console.error(`Could not find a packaged Archi.app under ${releaseDir} (looked in: ${candidateMacDirs.join(", ")}).`);
  process.exit(1);
}

const asarPath = path.join(macDir, "Archi.app", "Contents", "Resources", "app.asar");

const output = execSync(`npx asar list "${asarPath}"`, { encoding: "utf8" });
const asarEntries = new Set(output.split("\n").filter(Boolean));

const requiredEntries = [
  "/node_modules/@archi/destination-notion/node_modules/@notionhq/client/build/src/Client.js",
  "/node_modules/@archi/destination-notion/node_modules/node-fetch/lib/index.js",
  "/node_modules/@archi/destination-notion/node_modules/whatwg-url/lib/public-api.js",
  "/node_modules/@archi/destination-notion/node_modules/tr46/index.js",
  "/node_modules/@archi/destination-notion/node_modules/webidl-conversions/lib/index.js"
];

const missing = requiredEntries.filter((entry) => !asarEntries.has(entry));

if (missing.length > 0) {
  console.error("Packaged app is missing required runtime modules:");
  for (const entry of missing) {
    console.error(` - ${entry}`);
  }
  process.exit(1);
}

console.log("Packaged runtime verification passed.");
