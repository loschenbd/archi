import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve where the bundled bge-small-en-v1.5 model lives.
 * Callers (Electron main) pass `bundledRoot` so this package stays Electron-agnostic.
 *
 * - In dev: `apps/desktop/resources/models`
 * - In packaged build: `process.resourcesPath/models` (from electron-builder extraResources)
 */
export function resolveBundledModelDir(bundledRoot: string): string {
  const candidate = join(bundledRoot, "bge-small-en-v1.5");
  if (!existsSync(candidate)) {
    throw new Error(`bge-small-en-v1.5 model not found at ${candidate}`);
  }
  return candidate;
}
