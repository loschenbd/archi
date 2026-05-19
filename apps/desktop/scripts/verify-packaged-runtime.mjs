import { execSync } from "node:child_process";
import path from "node:path";

const asarPath = path.resolve(
  process.cwd(),
  "release",
  "mac-arm64",
  "Archi.app",
  "Contents",
  "Resources",
  "app.asar"
);

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
