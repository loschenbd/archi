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

  const codesign = run("codesign", ["--verify", "--verbose=2", dmgPath], { allowFail: true });
  if (codesign?.failed) {
    console.warn(`[verify-signing] WARN : DMG container is not codesigned (notarization staple still validates and is what Gatekeeper checks)`);
  } else {
    ok("DMG container codesigned");
  }

  const staple = run("stapler", ["validate", dmgPath], { allowFail: true });
  if (staple?.failed) fail(`stapler validate failed on DMG (notarization ticket missing):\n${staple.stdout || staple.stderr}`);
  ok("notarization ticket stapled to DMG");

  // For DMGs, `--type install` is the wrong spctl flag — that's for .pkg
  // installer packages. Apple's notarization docs use
  // `--type open --context context:primary-signature` to verify a notarized
  // DMG matches what Safari/Gatekeeper does when a user opens the download.
  const spctl = run(
    "spctl",
    ["--assess", "--type", "open", "--context", "context:primary-signature", "-vvv", dmgPath],
    { allowFail: true },
  );
  const spctlOut = spctl?.failed ? spctl.stderr : spctl;
  if (spctl?.failed) fail(`spctl --assess --type open rejected the DMG:\n${spctlOut}`);
  if (!/source=Notarized Developer ID/.test(spctlOut ?? "")) {
    fail(`spctl did not confirm "Notarized Developer ID" on the DMG:\n${spctlOut}`);
  }
  ok("spctl accepts DMG: Notarized Developer ID");
}

const dmgs = findDmgs();
const appPath = findApp();

verifyApp(appPath);
for (const dmg of dmgs) verifyDmg(dmg);

console.log("\n[verify-signing] All checks passed. Build is signed, notarized, and stapled.");
