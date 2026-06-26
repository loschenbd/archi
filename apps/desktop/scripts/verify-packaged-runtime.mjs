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

// @xenova/transformers eagerly loads a deep transitive tree at module init
// (jinja in tokenizers.js; onnxruntime-node + onnxruntime-web in backends/
// onnx.js, which in turn require onnxruntime-common, flatbuffers, protobufjs,
// long, …). With pnpm's isolated linker, electron-builder's dependency walk
// strips everything that isn't a DIRECT dep of apps/desktop — which is why the
// repo uses `node-linker=hoisted` (.npmrc) to flatten node_modules so the whole
// closure gets bundled. These are the load-bearing members whose absence makes
// packaged search crash at runtime; assert by substring (nesting path varies).
const requiredSubstrings = [
  "@huggingface/jinja",
  "onnxruntime-web",
  "onnxruntime-common", // required by onnxruntime-node/dist/index.js
  "/protobufjs/",       // onnx-proto → protobufjs closure
  "/flatbuffers/",
];
const allEntries = [...asarEntries];
const missingSubstrings = requiredSubstrings.filter(
  (needle) => !allEntries.some((entry) => entry.includes(needle))
);

if (missingSubstrings.length > 0) {
  console.error(
    "Packaged app is missing transitive @xenova/transformers deps (search will fail at module init):"
  );
  for (const needle of missingSubstrings) {
    console.error(` - ${needle}`);
  }
  process.exit(1);
}

const appRoot = path.join(macDir, "Archi.app");

const modelOnnx = path.join(
  appRoot,
  "Contents/Resources/models/bge-small-en-v1.5/onnx/model_quantized.onnx"
);
if (!fs.existsSync(modelOnnx)) {
  console.error(`Missing bundled embedding model: ${modelOnnx}`);
  process.exit(1);
}

function findFile(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(p, name);
      if (found) return found;
    } else if (entry.name === name) {
      return p;
    }
  }
  return null;
}

const unpackedRoot = path.join(appRoot, "Contents/Resources/app.asar.unpacked");
const vecDylib = findFile(unpackedRoot, "vec0.dylib");
if (!vecDylib) {
  console.error(
    "Missing sqlite-vec native binary (vec0.dylib) — packaged app will crash at db open"
  );
  process.exit(1);
}
console.log("[verify] bundled model + sqlite-vec present at", vecDylib);

console.log("Packaged runtime verification passed.");
