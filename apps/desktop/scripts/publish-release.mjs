// Publish the already-built, signed, notarized artifacts to a GitHub Release
// via the `gh` CLI — mirroring the CI publish step in
// .github/workflows/desktop-release.yml.
//
// Why gh instead of `electron-builder --publish always`: electron-builder's
// electron-publish HTTP uploader times out ("Request timed out") on the ~260MB
// DMG against GitHub's API. `gh release upload` uses the chunked-upload path and
// handles large files gracefully. See skill:
// electron-publish-times-out-on-large-dmg-use-gh-cli
//
// Run order (the `release` npm script): `pnpm package` builds + signs +
// notarizes + runs the verify gates with --publish never, THEN this publishes.
// Idempotent: re-running uploads to the existing release (--clobber).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");
const releaseDir = join(desktopRoot, "release");

function fail(msg) {
  console.error(`[publish-release] FAIL: ${msg}`);
  process.exit(1);
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

// --- version (source of truth: apps/desktop/package.json) ---
const version = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8")).version;
const tag = `v${version}`;

// --- repo (source of truth: electron-builder.yml publish config) ---
const ebYml = yaml.load(readFileSync(join(desktopRoot, "electron-builder.yml"), "utf8"));
const gh = (ebYml.publish || []).find((p) => p.provider === "github");
if (!gh?.owner || !gh?.repo) fail("no github publish provider (owner/repo) in electron-builder.yml");
const repo = `${gh.owner}/${gh.repo}`;

// --- artifacts (must exist from the prior `pnpm package` run) ---
// The zip is REQUIRED: electron-updater on macOS can only install updates
// from a zip target — a DMG-only release makes the in-app updater fail
// with "ZIP file not provided" and existing installs stay stranded.
const assets = [
  join(releaseDir, "Archi-arm64.dmg"),
  join(releaseDir, "Archi-arm64.zip"),
  join(releaseDir, "latest-mac.yml"),
  join(releaseDir, "Archi-arm64.dmg.blockmap"),
];
const missing = assets.filter((a) => !existsSync(a));
if (missing.length) fail(`missing build artifacts (run \`pnpm package\` first):\n  ${missing.join("\n  ")}`);

// zip blockmap enables differential updates; upload it when produced.
const zipBlockmap = join(releaseDir, "Archi-arm64.zip.blockmap");
if (existsSync(zipBlockmap)) assets.push(zipBlockmap);

// Guard: the update feed must reference the zip, or in-app updates still break.
const feed = yaml.load(readFileSync(join(releaseDir, "latest-mac.yml"), "utf8"));
if (!(feed.files || []).some((f) => f.url?.endsWith(".zip"))) {
  fail("latest-mac.yml does not reference a .zip file — macOS auto-update would fail");
}

// --- the release commit must be on the remote, else the tag points at nothing ---
const head = sh("git", ["rev-parse", "HEAD"]).trim();
try {
  // Empty output = the commit is NOT on any origin branch.
  const onRemote = sh("git", ["branch", "-r", "--contains", head]).trim();
  if (!onRemote) {
    fail(
      `HEAD (${head.slice(0, 9)}) is not pushed to origin — push it first so the ${tag} tag ` +
        `points at a real remote commit (e.g. \`git push origin main\`).`,
    );
  }
} catch {
  fail("could not determine whether HEAD is pushed (git branch -r --contains failed)");
}

console.log(`[publish-release] ${tag} → ${repo} @ ${head.slice(0, 9)}`);

// --- idempotent create, then clobbering upload (mirrors CI) ---
let exists = true;
try {
  sh("gh", ["release", "view", tag, "-R", repo], { stdio: ["ignore", "ignore", "ignore"] });
} catch {
  exists = false;
}

if (!exists) {
  console.log(`[publish-release] creating release ${tag}`);
  sh(
    "gh",
    [
      "release", "create", tag,
      "-R", repo,
      "--target", head,
      "--title", tag,
      "--notes", "macOS arm64 — signed, notarized, stapled.",
    ],
    { stdio: "inherit" },
  );
} else {
  console.log(`[publish-release] release ${tag} already exists — uploading assets to it`);
}

console.log("[publish-release] uploading assets...");
sh("gh", ["release", "upload", tag, "-R", repo, ...assets, "--clobber"], { stdio: "inherit" });

console.log(`[publish-release] OK: ${tag} published — https://github.com/${repo}/releases/tag/${tag}`);
