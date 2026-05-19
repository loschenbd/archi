import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const workspaceRoot = path.resolve(process.cwd(), "..", "..");

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: workspaceRoot,
    stdio: "pipe",
    encoding: "utf8",
    ...options
  });
}

function ok(message) {
  console.log(`OK: ${message}`);
}

function warn(message) {
  console.log(`WARN: ${message}`);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

const expectedNodeMajor = 20;
const actualMajor = Number(process.versions.node.split(".")[0]);
if (actualMajor === expectedNodeMajor) {
  ok(`Node.js major version is ${actualMajor}`);
} else {
  warn(`Expected Node.js major version ${expectedNodeMajor}, found ${process.versions.node}`);
}

const electronCheck = runCommand("pnpm", ["--filter", "@archi/desktop", "exec", "electron", "--version"]);
if (electronCheck.status === 0) {
  ok(`Electron binary available (${electronCheck.stdout.trim()})`);
} else {
  fail("Electron binary not available. Try reinstalling dependencies: pnpm install");
}

const playwrightCheck = runCommand("pnpm", ["--filter", "@archi/source-cloud-notebook", "exec", "playwright", "--version"]);
if (playwrightCheck.status === 0) {
  ok(`Playwright CLI available (${playwrightCheck.stdout.trim()})`);
} else {
  fail("Playwright CLI not available. Install dependencies and browser binaries.");
}

const playwrightBrowserCheck = runCommand("pnpm", [
  "--filter",
  "@archi/source-cloud-notebook",
  "exec",
  "node",
  "-e",
  "const { chromium } = require('playwright'); const fs = require('fs'); const p = chromium.executablePath(); console.log(p); process.exit(fs.existsSync(p) ? 0 : 1);"
]);
if (playwrightBrowserCheck.status === 0) {
  ok(`Playwright Chromium installed (${playwrightBrowserCheck.stdout.trim()})`);
} else {
  fail("Playwright Chromium browser binary is missing. Run: pnpm --filter @archi/source-cloud-notebook exec playwright install chromium");
}

const envFilePath = path.join(workspaceRoot, ".env");
if (!fs.existsSync(envFilePath)) {
  warn("No .env file found at workspace root. Copy .env.example to .env for local runs.");
} else {
  ok("Found .env file at workspace root");
  dotenv.config({ path: envFilePath, override: false });
}

if (process.env.NOTION_INTEGRATION_TOKEN) {
  ok("Notion token is present in current shell (PAT or integration token)");
} else {
  warn("NOTION_INTEGRATION_TOKEN is not set in current shell. You can still paste a PAT or integration token in-app during onboarding.");
}

if (process.exitCode && process.exitCode !== 0) {
  console.error("\nDoctor checks found blocking issues.");
} else {
  console.log("\nDoctor checks completed.");
}

