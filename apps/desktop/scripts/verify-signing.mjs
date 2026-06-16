import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TEAM_ID = "74KV536J36";
const EXPECTED_AUTHORITY = `Developer ID Application: Benjamin Loschen (${TEAM_ID})`;

const releaseDir = path.resolve(process.cwd(), "release");

function fail(msg) {
  console.error(`[verify-signing] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[verify-signing] OK   : ${msg}`);
}

function run(cmd, args, { allowFail = false } = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    if (allowFail) return { failed: true, stderr, stdout };
    fail(`${cmd} ${args.join(" ")} failed:\n${stderr || result.error?.message || "(no stderr)"}`);
  }
  return stdout + stderr;
}

function findDmgs() {
  if (!fs.existsSync(releaseDir)) fail(`release dir not found: ${releaseDir}`);
  const entries = fs.readdirSync(releaseDir);
  const dmgs = entries.filter((name) => name.endsWith(".dmg")).map((name) => path.join(releaseDir, name));
  if (dmgs.length === 0) fail(`no .dmg files in ${releaseDir}`);
  return dmgs;
}

function findApp() {
  const candidates = ["mac-arm64", "mac-x64", "mac-universal", "mac"];
  for (const sub of candidates) {
    const appPath = path.join(releaseDir, sub, "Archi.app");
    if (fs.existsSync(appPath)) return appPath;
  }
  fail(`no packaged Archi.app under ${releaseDir}/{${candidates.join(",")}}`);
}

function verifyApp(appPath) {
  console.log(`\n[verify-signing] checking app: ${appPath}`);

  const codesignDeep = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], { allowFail: true });
  if (codesignDeep?.failed) fail(`codesign --verify --deep --strict failed:\n${codesignDeep.stderr}`);
  ok("codesign --verify --deep --strict");

  const codesignInfo = run("codesign", ["-dvvv", appPath], { allowFail: true });
  const infoOut = (codesignInfo?.failed ? codesignInfo.stderr : codesignInfo) ?? "";
  if (!infoOut.includes(EXPECTED_AUTHORITY)) fail(`expected authority "${EXPECTED_AUTHORITY}" not found in codesign output`);
  ok(`authority is "${EXPECTED_AUTHORITY}"`);
  if (!infoOut.includes(`TeamIdentifier=${TEAM_ID}`)) fail(`expected TeamIdentifier=${TEAM_ID} not found`);
  ok(`team identifier ${TEAM_ID}`);
  if (!/flags=0x10000\(runtime\)/.test(infoOut)) fail("hardened runtime flag not set on app");
  ok("hardened runtime enabled");

  const staple = run("stapler", ["validate", appPath], { allowFail: true });
  if (staple?.failed) fail(`stapler validate failed on app (notarization ticket missing):\n${staple.stdout || staple.stderr}`);
  ok("notarization ticket stapled to app");

  const spctl = run("spctl", ["--assess", "--type", "execute", "-vvv", appPath], { allowFail: true });
  const spctlOut = spctl?.failed ? spctl.stderr : spctl;
  if (spctl?.failed) fail(`spctl --assess --type execute rejected the app:\n${spctlOut}`);
  if (!/source=Notarized Developer ID/.test(spctlOut ?? "")) fail(`spctl did not confirm "Notarized Developer ID":\n${spctlOut}`);
  ok("spctl: Notarized Developer ID");
}

function verifyDmg(dmgPath) {
  console.log(`\n[verify-signing] checking dmg: ${dmgPath}`);

  // electron-builder workflows produce DMGs that are NOT codesigned at the
  // container level — they rely entirely on the notarization staple for
  // Gatekeeper acceptance. `codesign --verify` on the container therefore
  // fails on shipping-correct DMGs; treat it as informational only.
  const codesign = run("codesign", ["--verify", "--verbose=2", dmgPath], { allowFail: true });
  if (codesign?.failed) {
    console.warn(
      `[verify-signing] note : DMG container is not codesigned (expected for electron-builder; the notarization staple is what Gatekeeper checks)`,
    );
  } else {
    ok("DMG container codesigned");
  }

  // Required: the notarization staple must be present on the DMG.
  const staple = run("stapler", ["validate", dmgPath], { allowFail: true });
  if (staple?.failed) fail(`stapler validate failed on DMG (notarization ticket missing):\n${staple.stdout || staple.stderr}`);
  ok("notarization ticket stapled to DMG");

  // Preferred: `gktool scan` is Apple's modern Gatekeeper assessment tool
  // (Sequoia+). It is the authoritative "would Gatekeeper accept this on
  // download?" check. Unlike `spctl --assess` (which expects a codesign
  // signature on the container and rejects notarized-only DMGs with
  // "no usable signature"), gktool understands the notarized-staple-only
  // case and returns "allowed by system policy" for valid DMGs.
  //
  // gktool is not present on macOS Sonoma (14.x) — GitHub Actions' macos-14
  // runner falls in that bucket. Skip on platforms where it's missing.
  const which = run("which", ["gktool"], { allowFail: true });
  const gktoolPath = (typeof which === "string" ? which : "").trim();
  if (gktoolPath) {
    const gk = run("gktool", ["scan", dmgPath], { allowFail: true });
    const gkOut = (gk?.failed ? gk.stderr : gk) ?? "";
    // gktool emits two flavors of success:
    //   "Scan completed and software is allowed by system policy."
    //   "Scan completed, and would be allowed but the user still needs to
    //    approve it on first launch."
    // Both are valid (the second is normal Sequoia behavior for a
    // notarized app on first launch). Match either via /allowed/i.
    // A real rejection would say "blocked" or "denied".
    if (gk?.failed || /\b(blocked|denied)\b/i.test(gkOut) || !/allowed/i.test(gkOut)) {
      fail(`gktool scan did not accept the DMG:\n${gkOut}`);
    }
    ok(`gktool: ${gkOut.trim().split("\n")[0]}`);
  } else {
    console.log(
      "[verify-signing] note : gktool not present (macOS < Sequoia); relying on stapler + .app verification",
    );
  }
}

const dmgs = findDmgs();
const appPath = findApp();

verifyApp(appPath);
for (const dmg of dmgs) verifyDmg(dmg);

console.log("\n[verify-signing] All checks passed. Build is signed, notarized, and stapled.");
