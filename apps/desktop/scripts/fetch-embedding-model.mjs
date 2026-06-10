import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TARGET_DIR = join(ROOT, "resources/models/bge-small-en-v1.5");

// Files matched by @xenova/transformers' default Xenova/bge-small-en-v1.5 layout.
const BASE = "https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/main";
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx"
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchFile(relPath) {
  const dest = join(TARGET_DIR, relPath);
  await mkdir(dirname(dest), { recursive: true });
  if (await exists(dest)) {
    console.log(`[fetch-model] cached ${relPath}`);
    return;
  }
  const url = `${BASE}/${relPath}`;
  console.log(`[fetch-model] downloading ${relPath}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function main() {
  await mkdir(TARGET_DIR, { recursive: true });
  for (const f of FILES) await fetchFile(f);
  console.log("[fetch-model] complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
