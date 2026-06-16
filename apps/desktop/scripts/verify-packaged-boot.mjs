import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Boot the packaged Archi.app and assert the main process actually initializes
// without throwing — catches issues that file-presence checks miss, e.g. a
// native .dylib that's present in app.asar.unpacked but loaded with the wrong
// path. v0.2.1 shipped a broken main process because sqlite-vec's
// getLoadablePath() returned an /app.asar/ path that dlopen couldn't follow;
// the renderer surfaced "No handler registered for 'archi:get-settings'" only
// after install. This script reproduces that failure mode on every package.

const TIMEOUT_MS = 15_000;

const releaseDir = path.resolve(process.cwd(), "release");
const candidateMacDirs = ["mac-arm64", "mac-x64", "mac-universal", "mac"];
const macDir = candidateMacDirs
  .map((name) => path.join(releaseDir, name))
  .find((dir) => fs.existsSync(path.join(dir, "Archi.app")));

if (!macDir) {
  console.error(`[verify-boot] FAIL: could not find packaged Archi.app under ${releaseDir}`);
  process.exit(1);
}

const binary = path.join(macDir, "Archi.app", "Contents", "MacOS", "Archi");
if (!fs.existsSync(binary)) {
  console.error(`[verify-boot] FAIL: binary missing at ${binary}`);
  process.exit(1);
}

// Isolated user-data dir so the test never collides with the user's real data
// or with a stale SingletonLock from a prior run.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "archi-bootsmoke-"));

const fatalPatterns = [
  /UnhandledPromiseRejectionWarning/i,
  /SqliteError/i,
  /\bdlopen\b.*errno=/i,
  /Cannot find module/i,
  /TypeError: .* is not a function/i,
  /Error: ENO\w+/i,
];

const buffers = { stdout: "", stderr: "" };
const child = spawn(binary, ["--user-data-dir", userDataDir], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
});

let resolved = false;
function finish(code, reason) {
  if (resolved) return;
  resolved = true;
  try { child.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1500).unref();
  if (code === 0) {
    console.log(`[verify-boot] OK   : ${reason}`);
  } else {
    console.error(`[verify-boot] FAIL: ${reason}`);
    if (buffers.stderr) console.error(`--- stderr ---\n${buffers.stderr}\n--- end ---`);
    if (buffers.stdout) console.error(`--- stdout ---\n${buffers.stdout}\n--- end ---`);
  }
  // Hand off exit so the kill has time to fire.
  setTimeout(() => process.exit(code), 100).unref();
}

function scan(stream, chunk) {
  const text = chunk.toString();
  buffers[stream] += text;
  for (const pattern of fatalPatterns) {
    if (pattern.test(text)) {
      finish(1, `main process emitted fatal pattern: ${pattern}`);
      return;
    }
  }
}

child.stdout.on("data", (chunk) => scan("stdout", chunk));
child.stderr.on("data", (chunk) => scan("stderr", chunk));
child.on("exit", (code, signal) => {
  if (resolved) return;
  if (signal === "SIGTERM" || signal === "SIGKILL") return;
  finish(1, `main process exited prematurely (code=${code}, signal=${signal})`);
});

setTimeout(() => finish(0, `main process stayed alive for ${TIMEOUT_MS}ms with no fatal errors`), TIMEOUT_MS).unref();
