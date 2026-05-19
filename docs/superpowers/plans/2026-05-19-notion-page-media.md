# Notion Page Icon + Cover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Library page in Notion show a meaningful icon and cover image after sync — image when available, type-appropriate emoji fallback — with idempotency and a user-triggered "Refresh Notion media" action.

**Architecture:** Extract media-decision logic into a new `packages/destination-notion/src/media.ts` module with two pure-ish exports: `chooseMedia(work)` and `applyPageMedia(client, pageId, desired, opts)`. The Notion client is passed as a parameter (typed via a minimal interface) so tests can supply a fake without touching the real SDK. The existing `NotionDestination` class calls `applyPageMedia(this.client, ...)` from `upsertLibraryWork`, wrapped in a try/catch that classifies URL-rejection errors and falls back to an emoji-only update. A new `forceRefreshMedia` option threads through `syncBatch` and is set from a new desktop IPC channel triggered by a button on the Connections screen.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` extensions on TS imports), `@notionhq/client@^2.2.15`, Electron `^31`, React `^18`, Vitest. Package namespace `@archi/*`. Test runner is `vitest run --passWithNoTests`. Repository is under git; commit at the end of each task using the existing `<package>: <message>` style.

**Spec:** `docs/superpowers/specs/2026-05-19-notion-page-media-design.md`

---

## File structure

**New files (3):**
- `packages/destination-notion/src/media.ts` — types (`DesiredIcon`, `DesiredMedia`, `MediaNotionClient`), pure helpers (`emojiFor`, `chooseMedia`, `isMediaUrlRejection`), the Notion-touching helper `applyPageMedia`.
- `packages/destination-notion/tests/media.test.ts` — all pure-function and mocked-client tests for `media.ts`.
- `packages/destination-notion/README.md` — short doc on icon/cover selection, force refresh, known limitations.

**Modified files (6):**
- `packages/destination-notion/src/index.ts` — extend `NotionSyncBatchOptions` with `forceRefreshMedia`, thread it through `syncBatch` → `upsertLibraryWork`, call `applyPageMedia` after page upsert with try/catch emoji-fallback handler.
- `apps/desktop/src/main/index.ts` — extend `runSync`/`runSyncOnce` to accept `{ forceRefreshMedia }`, pass to `notionDestination.syncBatch`; new IPC handler `archi:refresh-notion-media`.
- `apps/desktop/src/preload/index.ts` — expose `archi.refreshNotionMedia()`.
- `apps/desktop/src/renderer/env.d.ts` — add type for `refreshNotionMedia`.
- `apps/desktop/src/renderer/App.tsx` — add `refreshNotionMedia` handler with confirm dialog, pass to `ConnectionsScreen`.
- `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx` — add `onRefreshNotionMedia` prop + button in the Notion card's action row.

---

## Conventions

**Working directory:** all commands assume `cwd = /Users/benjaminloschen/Projects/archi`.

**ESM imports:** TypeScript files import with `.js` extensions (NodeNext). Example: `import { chooseMedia } from "./media.js";`.

**Test runner:** `pnpm --filter @archi/destination-notion test` runs vitest in the destination-notion package. `pnpm --filter @archi/destination-notion typecheck` runs `tsc --noEmit`.

**Commit message style** (match existing log):
```
notion-destination: <subject in lowercase>
```

---

## Task 1: Scaffold media module + chooseMedia (pure)

**Files:**
- Create: `packages/destination-notion/src/media.ts`
- Create: `packages/destination-notion/tests/media.test.ts`

- [ ] **Step 1: Write the failing tests for chooseMedia**

Create `packages/destination-notion/tests/media.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chooseMedia, emojiFor } from "../src/media.js";

const baseWork = {
  displayTitle: "Book Title",
  workType: "book",
  ingestSource: "device-export",
  labels: [],
  isArchived: false
} as const;

describe("emojiFor", () => {
  it("maps known work types to emoji", () => {
    expect(emojiFor("book")).toEqual("📚");
    expect(emojiFor("article")).toEqual("📰");
    expect(emojiFor("periodical")).toEqual("🗞️");
    expect(emojiFor("document")).toEqual("📄");
    expect(emojiFor("other")).toEqual("📌");
  });

  it("falls back to 📌 for unknown types", () => {
    expect(emojiFor("podcast")).toEqual("📌");
    expect(emojiFor("")).toEqual("📌");
  });
});

describe("chooseMedia", () => {
  it("returns external_url icon + coverUrl when coverImageUrl is set", () => {
    const result = chooseMedia({ ...baseWork, coverImageUrl: "https://images/abc.jpg" });
    expect(result).toEqual({
      icon: { type: "external_url", url: "https://images/abc.jpg" },
      coverUrl: "https://images/abc.jpg"
    });
  });

  it("returns book emoji + no coverUrl when coverImageUrl is missing", () => {
    const result = chooseMedia({ ...baseWork, coverImageUrl: undefined });
    expect(result).toEqual({
      icon: { type: "emoji", emoji: "📚" },
      coverUrl: undefined
    });
  });

  it("treats whitespace-only coverImageUrl as missing", () => {
    const result = chooseMedia({ ...baseWork, coverImageUrl: "   " });
    expect(result).toEqual({
      icon: { type: "emoji", emoji: "📚" },
      coverUrl: undefined
    });
  });

  it("uses the article emoji for article work type", () => {
    const result = chooseMedia({ ...baseWork, workType: "article", coverImageUrl: undefined });
    expect(result.icon).toEqual({ type: "emoji", emoji: "📰" });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail with "Cannot find module"**

Run: `pnpm --filter @archi/destination-notion test`
Expected: FAIL with errors about `../src/media.js` not found.

- [ ] **Step 3: Create the media module with chooseMedia + emojiFor**

Create `packages/destination-notion/src/media.ts`:

```ts
import type { NotionWorkInput } from "./index.js";

export type DesiredIcon =
  | { type: "external_url"; url: string }
  | { type: "emoji"; emoji: string };

export type DesiredMedia = {
  icon: DesiredIcon;
  coverUrl?: string;
};

const EMOJI_BY_TYPE: Record<string, string> = {
  book: "📚",
  article: "📰",
  periodical: "🗞️",
  document: "📄",
  other: "📌"
};

export function emojiFor(workType: string): string {
  return EMOJI_BY_TYPE[workType] ?? "📌";
}

export function chooseMedia(work: Pick<NotionWorkInput, "workType" | "coverImageUrl">): DesiredMedia {
  const url = work.coverImageUrl?.trim();
  if (url) {
    return {
      icon: { type: "external_url", url },
      coverUrl: url
    };
  }
  return {
    icon: { type: "emoji", emoji: emojiFor(work.workType) },
    coverUrl: undefined
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @archi/destination-notion test`
Expected: PASS — 6 passing.

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @archi/destination-notion typecheck`
Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add packages/destination-notion/src/media.ts packages/destination-notion/tests/media.test.ts
git commit -m "notion-destination: add chooseMedia + emojiFor helpers"
```

---

## Task 2: applyPageMedia — new-page short-circuit + no-op when matching

**Files:**
- Modify: `packages/destination-notion/src/media.ts`
- Modify: `packages/destination-notion/tests/media.test.ts`

- [ ] **Step 1: Add failing tests for applyPageMedia (new page + no-op)**

Append to `packages/destination-notion/tests/media.test.ts`:

```ts
import { vi } from "vitest";
import { applyPageMedia, type MediaNotionClient } from "../src/media.js";

function makeClient(overrides: Partial<{
  retrieve: (args: { page_id: string }) => unknown;
}> = {}): {
  client: MediaNotionClient;
  retrieve: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  const retrieve = vi.fn(overrides.retrieve ?? (async () => ({ icon: null, cover: null })));
  const update = vi.fn(async () => ({}));
  return {
    client: { pages: { retrieve, update } } as MediaNotionClient,
    retrieve,
    update
  };
}

const externalDesired = {
  icon: { type: "external_url" as const, url: "https://images/abc.jpg" },
  coverUrl: "https://images/abc.jpg"
};

const emojiDesired = {
  icon: { type: "emoji" as const, emoji: "📚" },
  coverUrl: undefined
};

describe("applyPageMedia", () => {
  it("writes icon+cover without retrieving on a new page with URL", async () => {
    const { client, retrieve, update } = makeClient();

    await applyPageMedia(client, "page_1", externalDesired, { force: false, isNewPage: true });

    expect(retrieve).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_1",
      icon: { type: "external", external: { url: "https://images/abc.jpg" } },
      cover: { type: "external", external: { url: "https://images/abc.jpg" } }
    });
  });

  it("writes emoji icon and no cover on a new page without URL", async () => {
    const { client, retrieve, update } = makeClient();

    await applyPageMedia(client, "page_2", emojiDesired, { force: false, isNewPage: true });

    expect(retrieve).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_2",
      icon: { type: "emoji", emoji: "📚" }
    });
  });

  it("retrieves once and does not update when existing page already matches", async () => {
    const { client, retrieve, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "external", external: { url: "https://images/abc.jpg" } },
        cover: { type: "external", external: { url: "https://images/abc.jpg" } }
      })
    });

    await applyPageMedia(client, "page_3", externalDesired, { force: false, isNewPage: false });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith({ page_id: "page_3" });
    expect(update).not.toHaveBeenCalled();
  });

  it("does not update when existing emoji icon already matches and no URL", async () => {
    const { client, retrieve, update } = makeClient({
      retrieve: async () => ({ icon: { type: "emoji", emoji: "📚" }, cover: null })
    });

    await applyPageMedia(client, "page_4", emojiDesired, { force: false, isNewPage: false });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `pnpm --filter @archi/destination-notion test`
Expected: FAIL — `applyPageMedia` is not exported.

- [ ] **Step 3: Add applyPageMedia + MediaNotionClient to media.ts**

Append to `packages/destination-notion/src/media.ts`:

```ts
export type MediaNotionClient = {
  pages: {
    retrieve: (args: { page_id: string }) => Promise<unknown>;
    update: (args: { page_id: string; icon?: unknown; cover?: unknown }) => Promise<unknown>;
  };
};

export type ApplyPageMediaOptions = {
  force: boolean;
  isNewPage: boolean;
};

type CurrentIcon =
  | { kind: "external"; url: string }
  | { kind: "emoji"; emoji: string }
  | null;

type CurrentCover = { url: string } | null;

type NotionIconShape =
  | { type: "external"; external: { url: string } }
  | { type: "emoji"; emoji: string }
  | null
  | undefined;

type NotionCoverShape =
  | { type: "external"; external: { url: string } }
  | null
  | undefined;

function normalizeCurrentIcon(icon: NotionIconShape): CurrentIcon {
  if (!icon) return null;
  if (icon.type === "external") return { kind: "external", url: icon.external.url };
  if (icon.type === "emoji") return { kind: "emoji", emoji: icon.emoji };
  return null;
}

function normalizeCurrentCover(cover: NotionCoverShape): CurrentCover {
  if (!cover) return null;
  if (cover.type === "external") return { url: cover.external.url };
  return null;
}

function iconShape(desired: DesiredIcon): { type: "external"; external: { url: string } } | { type: "emoji"; emoji: string } {
  if (desired.type === "external_url") {
    return { type: "external", external: { url: desired.url } };
  }
  return { type: "emoji", emoji: desired.emoji };
}

function coverShape(url: string): { type: "external"; external: { url: string } } {
  return { type: "external", external: { url } };
}

function iconMatches(current: CurrentIcon, desired: DesiredIcon): boolean {
  if (!current) return false;
  if (desired.type === "external_url") {
    return current.kind === "external" && current.url === desired.url;
  }
  return current.kind === "emoji" && current.emoji === desired.emoji;
}

function coverMatches(current: CurrentCover, desiredUrl: string | undefined): boolean {
  if (!desiredUrl) return current === null;
  return current !== null && current.url === desiredUrl;
}

export async function applyPageMedia(
  client: MediaNotionClient,
  pageId: string,
  desired: DesiredMedia,
  opts: ApplyPageMediaOptions
): Promise<void> {
  if (opts.isNewPage) {
    const body: { page_id: string; icon?: unknown; cover?: unknown } = {
      page_id: pageId,
      icon: iconShape(desired.icon)
    };
    if (desired.coverUrl) {
      body.cover = coverShape(desired.coverUrl);
    }
    await client.pages.update(body);
    return;
  }

  const page = (await client.pages.retrieve({ page_id: pageId })) as {
    icon?: NotionIconShape;
    cover?: NotionCoverShape;
  };
  const currentIcon = normalizeCurrentIcon(page.icon);
  const currentCover = normalizeCurrentCover(page.cover);

  const iconChanged = opts.force || !iconMatches(currentIcon, desired.icon);
  const coverChanged = opts.force || !coverMatches(currentCover, desired.coverUrl);

  if (!iconChanged && !coverChanged) {
    return;
  }

  const body: { page_id: string; icon?: unknown; cover?: unknown } = { page_id: pageId };
  if (iconChanged) {
    body.icon = iconShape(desired.icon);
  }
  if (coverChanged) {
    // Spec: do not clear an existing cover on normal syncs when our URL disappears.
    if (!desired.coverUrl && !opts.force) {
      // skip cover patch
    } else {
      body.cover = desired.coverUrl ? coverShape(desired.coverUrl) : null;
    }
  }

  if (body.icon === undefined && body.cover === undefined) {
    return;
  }

  await client.pages.update(body);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @archi/destination-notion test`
Expected: PASS — 10 passing total.

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @archi/destination-notion typecheck`
Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add packages/destination-notion/src/media.ts packages/destination-notion/tests/media.test.ts
git commit -m "notion-destination: applyPageMedia with new-page short-circuit + no-op match"
```

---

## Task 3: applyPageMedia — partial diffs and force flag

**Files:**
- Modify: `packages/destination-notion/tests/media.test.ts`

The previous task's implementation already handles partial diffs and the force flag. This task adds the corresponding tests to lock the behavior in.

- [ ] **Step 1: Append failing tests for partial diffs + force**

Append to `packages/destination-notion/tests/media.test.ts` (inside the existing `describe("applyPageMedia", …)` block — add a new nested describe or just more `it`s; the example below uses more `it`s in the same block):

```ts
  it("updates icon only when icon differs and cover matches", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "emoji", emoji: "📚" },
        cover: { type: "external", external: { url: "https://images/abc.jpg" } }
      })
    });

    await applyPageMedia(client, "page_diff_icon", externalDesired, { force: false, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_diff_icon",
      icon: { type: "external", external: { url: "https://images/abc.jpg" } }
    });
  });

  it("updates cover only when cover differs and icon matches", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "external", external: { url: "https://images/abc.jpg" } },
        cover: { type: "external", external: { url: "https://images/old.jpg" } }
      })
    });

    await applyPageMedia(client, "page_diff_cover", externalDesired, { force: false, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_diff_cover",
      cover: { type: "external", external: { url: "https://images/abc.jpg" } }
    });
  });

  it("updates both when no current icon or cover and URL present", async () => {
    const { client, update } = makeClient({ retrieve: async () => ({ icon: null, cover: null }) });

    await applyPageMedia(client, "page_blank", externalDesired, { force: false, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_blank",
      icon: { type: "external", external: { url: "https://images/abc.jpg" } },
      cover: { type: "external", external: { url: "https://images/abc.jpg" } }
    });
  });

  it("overwrites a user-set emoji with our emoji when URL is absent (trust-on-first-write)", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({ icon: { type: "emoji", emoji: "⭐" }, cover: null })
    });

    await applyPageMedia(client, "page_user_emoji", emojiDesired, { force: false, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_user_emoji",
      icon: { type: "emoji", emoji: "📚" }
    });
  });

  it("rewrites icon+cover on force even when current matches desired", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "external", external: { url: "https://images/abc.jpg" } },
        cover: { type: "external", external: { url: "https://images/abc.jpg" } }
      })
    });

    await applyPageMedia(client, "page_force", externalDesired, { force: true, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_force",
      icon: { type: "external", external: { url: "https://images/abc.jpg" } },
      cover: { type: "external", external: { url: "https://images/abc.jpg" } }
    });
  });

  it("clears cover when force=true and desired has no coverUrl", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "emoji", emoji: "📚" },
        cover: { type: "external", external: { url: "https://images/old.jpg" } }
      })
    });

    await applyPageMedia(client, "page_force_clear", emojiDesired, { force: true, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_force_clear",
      icon: { type: "emoji", emoji: "📚" },
      cover: null
    });
  });

  it("does NOT clear cover on normal sync when URL disappears", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "emoji", emoji: "📚" },
        cover: { type: "external", external: { url: "https://images/old.jpg" } }
      })
    });

    await applyPageMedia(client, "page_no_clear", emojiDesired, { force: false, isNewPage: false });

    // Icon matches current emoji, no change. Cover would differ but rule says don't clear on normal sync.
    expect(update).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests, verify pass**

Run: `pnpm --filter @archi/destination-notion test`
Expected: PASS — 17 total. (No implementation change — Task 2's code already covers these behaviors.)

- [ ] **Step 3: Commit**

```bash
git add packages/destination-notion/tests/media.test.ts
git commit -m "notion-destination: lock applyPageMedia partial-diff and force behavior with tests"
```

---

## Task 4: isMediaUrlRejection classifier

**Files:**
- Modify: `packages/destination-notion/src/media.ts`
- Modify: `packages/destination-notion/tests/media.test.ts`

- [ ] **Step 1: Add failing tests for isMediaUrlRejection**

Append to `packages/destination-notion/tests/media.test.ts`:

```ts
import { isMediaUrlRejection } from "../src/media.js";

class FakeNotionError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

describe("isMediaUrlRejection", () => {
  it("returns true for validation_error with 'Invalid image url'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("Invalid image url", "validation_error"))).toBe(true);
  });

  it("returns true for validation_error with 'url is not a valid url'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("url is not a valid url", "validation_error"))).toBe(true);
  });

  it("returns true for validation_error with 'image is too large'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("image is too large", "validation_error"))).toBe(true);
  });

  it("returns true for validation_error with 'unsupported image'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("unsupported image format", "validation_error"))).toBe(true);
  });

  it("returns true for validation_error with 'external url is invalid'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("external url is invalid", "validation_error"))).toBe(true);
  });

  it("returns true for validation_error with 'could not download'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("could not download image", "validation_error"))).toBe(true);
  });

  it("returns false for validation_error with an unrelated message", () => {
    expect(isMediaUrlRejection(new FakeNotionError("title is required", "validation_error"))).toBe(false);
  });

  it("returns false for rate_limited", () => {
    expect(isMediaUrlRejection(new FakeNotionError("Invalid image url", "rate_limited"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isMediaUrlRejection("Invalid image url")).toBe(false);
    expect(isMediaUrlRejection(null)).toBe(false);
    expect(isMediaUrlRejection(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `pnpm --filter @archi/destination-notion test`
Expected: FAIL — `isMediaUrlRejection` not exported.

- [ ] **Step 3: Implement isMediaUrlRejection in media.ts**

Append to `packages/destination-notion/src/media.ts`:

```ts
const URL_REJECTION_PATTERN = /invalid image url|url is not a valid url|image is too large|unsupported image|external url is invalid|could not download/i;

export function isMediaUrlRejection(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as Error & { code?: string }).code;
  if (code !== "validation_error") {
    return false;
  }
  return URL_REJECTION_PATTERN.test(error.message);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @archi/destination-notion test`
Expected: PASS — 26 total.

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @archi/destination-notion typecheck`
Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add packages/destination-notion/src/media.ts packages/destination-notion/tests/media.test.ts
git commit -m "notion-destination: classify Notion URL-rejection errors"
```

---

## Task 5: Thread forceRefreshMedia through syncBatch + integrate applyPageMedia

**Files:**
- Modify: `packages/destination-notion/src/index.ts`

This wires `applyPageMedia` into the upsert flow with a per-page try/catch that uses `isMediaUrlRejection` for fallback. No new tests in this task — Task 6 adds integration tests via the existing upsert path.

- [ ] **Step 1: Extend NotionSyncBatchOptions**

In `packages/destination-notion/src/index.ts`, edit the `NotionSyncBatchOptions` type at index.ts:103-105:

```ts
export type NotionSyncBatchOptions = {
  onProgress?: (event: NotionSyncBatchProgressEvent) => void;
  forceRefreshMedia?: boolean;
};
```

- [ ] **Step 2: Import media helpers at the top of index.ts**

Add to the top of `packages/destination-notion/src/index.ts` (after the existing `import` line):

```ts
import { applyPageMedia, chooseMedia, emojiFor, isMediaUrlRejection } from "./media.js";
```

- [ ] **Step 3: Read forceRefreshMedia in syncBatch and pass to upsertLibraryWork**

In `syncBatch` (index.ts:378-407), capture the flag once and pass it through. Edit the works loop:

Before (index.ts:384-395):
```ts
    for (const [index, work] of works.entries()) {
      const normalizedWork: NotionWorkInput = {
        ...work,
        externalId: this.resolveWorkExternalId(work),
        lastSyncedAt: syncedAt
      };
      const pageId = await this.upsertLibraryWork(libraryDatabaseId, passagesDatabaseId, normalizedWork);
      if (work.sourceWorkId) {
        workPageBySourceId.set(work.sourceWorkId, pageId);
      }
      options?.onProgress?.({ phase: "works", processed: index + 1, total: works.length });
    }
```

After:
```ts
    const forceRefreshMedia = options?.forceRefreshMedia ?? false;
    for (const [index, work] of works.entries()) {
      const normalizedWork: NotionWorkInput = {
        ...work,
        externalId: this.resolveWorkExternalId(work),
        lastSyncedAt: syncedAt
      };
      const pageId = await this.upsertLibraryWork(libraryDatabaseId, passagesDatabaseId, normalizedWork, forceRefreshMedia);
      if (work.sourceWorkId) {
        workPageBySourceId.set(work.sourceWorkId, pageId);
      }
      options?.onProgress?.({ phase: "works", processed: index + 1, total: works.length });
    }
```

- [ ] **Step 4: Update upsertLibraryWork signature + integrate applyPageMedia**

Edit the `upsertLibraryWork` method (index.ts:409-449). Change the signature and add the media call:

Before:
```ts
  private async upsertLibraryWork(
    libraryDatabaseId: string,
    passagesDatabaseId: string,
    work: NotionWorkInput
  ): Promise<string> {
    const externalId = this.normalizeTextValue(work.externalId);
    const existing =
      (await this.findOneByRichText(libraryDatabaseId, "External ID", externalId)) ??
      (await this.findLegacyLibraryWorkWithoutExternalId(libraryDatabaseId, work));
    const properties = {
      // ... unchanged ...
    };

    if (existing) {
      await this.updatePageProperties(existing.id, properties);
      await this.tryEnsureWorkPageQuotesFeed(existing.id, passagesDatabaseId);
      return existing.id;
    }

    const created = await this.withRetry(() =>
      this.client.pages.create({
        parent: { database_id: libraryDatabaseId },
        properties: properties as never
      })
    );
    await this.tryEnsureWorkPageQuotesFeed(created.id, passagesDatabaseId);
    return created.id;
  }
```

After (keep `properties` block exactly as it is — only the signature, the post-upsert calls, and one new helper invocation change):
```ts
  private async upsertLibraryWork(
    libraryDatabaseId: string,
    passagesDatabaseId: string,
    work: NotionWorkInput,
    forceRefreshMedia: boolean
  ): Promise<string> {
    const externalId = this.normalizeTextValue(work.externalId);
    const existing =
      (await this.findOneByRichText(libraryDatabaseId, "External ID", externalId)) ??
      (await this.findLegacyLibraryWorkWithoutExternalId(libraryDatabaseId, work));
    const properties = {
      // ... unchanged ...
    };

    let pageId: string;
    let isNewPage: boolean;
    if (existing) {
      await this.updatePageProperties(existing.id, properties);
      pageId = existing.id;
      isNewPage = false;
    } else {
      const created = await this.withRetry(() =>
        this.client.pages.create({
          parent: { database_id: libraryDatabaseId },
          properties: properties as never
        })
      );
      pageId = created.id;
      isNewPage = true;
    }

    await this.applyMediaForWork(pageId, work, forceRefreshMedia, isNewPage);
    await this.tryEnsureWorkPageQuotesFeed(pageId, passagesDatabaseId);
    return pageId;
  }

  private async applyMediaForWork(
    pageId: string,
    work: NotionWorkInput,
    forceRefreshMedia: boolean,
    isNewPage: boolean
  ): Promise<void> {
    const desired = chooseMedia(work);
    try {
      await this.withRetry(() => applyPageMedia(this.client, pageId, desired, { force: forceRefreshMedia, isNewPage }));
    } catch (error) {
      if (isMediaUrlRejection(error)) {
        try {
          await this.withRetry(() =>
            this.client.pages.update({
              page_id: pageId,
              icon: { type: "emoji", emoji: emojiFor(work.workType) }
            } as never)
          );
        } catch {
          // Emoji fallback failed too. Sync stays alive; the page just won't get media this run.
        }
        return;
      }
      // Non-URL-rejection error: log and move on. Sync continues.
      console.warn(`[notion-destination] applyPageMedia failed for page ${pageId}:`, error);
    }
  }
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @archi/destination-notion typecheck`
Expected: clean exit.

- [ ] **Step 6: Run existing tests**

Run: `pnpm --filter @archi/destination-notion test`
Expected: PASS — 26 (no new tests yet, but the existing media tests must still pass and TypeScript must compile).

- [ ] **Step 7: Commit**

```bash
git add packages/destination-notion/src/index.ts
git commit -m "notion-destination: wire applyPageMedia into upsertLibraryWork + forceRefreshMedia option"
```

---

## Task 6: Integration tests for the URL-rejection fallback path

**Files:**
- Create: `packages/destination-notion/tests/url-rejection-fallback.test.ts`

Test the integration of `applyPageMedia` with `isMediaUrlRejection` by exercising the helper that `upsertLibraryWork` will call. We can't test the full class without standing up the entire Notion mock surface, so we test the fallback policy as a focused helper.

Note on scope: this task does not refactor `applyMediaForWork` out of the class. Instead, it adds tests that exercise the **policy** — "given a Notion client whose `update` throws X, the right thing happens" — by hand-rolling a fake client and calling `applyPageMedia` directly, then asserting on what `isMediaUrlRejection(error)` returns for the thrown error. The actual fallback emoji write inside `applyMediaForWork` is a thin wrapper around `client.pages.update` that is verified manually (see Task 11).

- [ ] **Step 1: Create the test file**

Create `packages/destination-notion/tests/url-rejection-fallback.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { applyPageMedia, isMediaUrlRejection, type MediaNotionClient } from "../src/media.js";

class FakeNotionError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

describe("URL-rejection fallback policy", () => {
  it("applyPageMedia surfaces the Notion error so callers can classify it", async () => {
    const update = vi.fn(async () => {
      throw new FakeNotionError("Invalid image url", "validation_error");
    });
    const client: MediaNotionClient = {
      pages: { retrieve: vi.fn(), update }
    };

    let caught: unknown;
    try {
      await applyPageMedia(
        client,
        "page_bad_url",
        { icon: { type: "external_url", url: "https://bad/img.jpg" }, coverUrl: "https://bad/img.jpg" },
        { force: false, isNewPage: true }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FakeNotionError);
    expect(isMediaUrlRejection(caught)).toBe(true);
  });

  it("isMediaUrlRejection lets rate_limited bubble up (not a URL rejection)", async () => {
    const update = vi.fn(async () => {
      throw new FakeNotionError("rate limited; retry later", "rate_limited");
    });
    const client: MediaNotionClient = {
      pages: { retrieve: vi.fn(), update }
    };

    let caught: unknown;
    try {
      await applyPageMedia(
        client,
        "page_rate_limited",
        { icon: { type: "external_url", url: "https://ok/img.jpg" }, coverUrl: "https://ok/img.jpg" },
        { force: false, isNewPage: true }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FakeNotionError);
    expect(isMediaUrlRejection(caught)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify pass**

Run: `pnpm --filter @archi/destination-notion test`
Expected: PASS — 28 total.

- [ ] **Step 3: Commit**

```bash
git add packages/destination-notion/tests/url-rejection-fallback.test.ts
git commit -m "notion-destination: integration tests for URL-rejection fallback policy"
```

---

## Task 7: Main process — forceRefreshMedia plumbing + IPC handler

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Locate the syncBatch call and thread the option through runSync**

Find the `runSync` declaration at `apps/desktop/src/main/index.ts:1114`:

Before:
```ts
  const runSync = (): Promise<typeof state> => {
    if (inFlightSync) {
      return inFlightSync;
    }
    inFlightSync = runSyncOnce().finally(() => {
      inFlightSync = null;
      inFlightRunId = null;
      inFlightRunStartedAtMs = null;
      cancelSyncRequested = false;
      cancelSyncController = null;
    });
    return inFlightSync;
  };
```

After:
```ts
  const runSync = (opts?: { forceRefreshMedia?: boolean }): Promise<typeof state> => {
    if (inFlightSync) {
      return inFlightSync;
    }
    inFlightSync = runSyncOnce({ forceRefreshMedia: opts?.forceRefreshMedia ?? false }).finally(() => {
      inFlightSync = null;
      inFlightRunId = null;
      inFlightRunStartedAtMs = null;
      cancelSyncRequested = false;
      cancelSyncController = null;
    });
    return inFlightSync;
  };
```

- [ ] **Step 2: Update runSyncOnce signature**

Find `runSyncOnce` at `apps/desktop/src/main/index.ts:433`. Change:

Before:
```ts
  const runSyncOnce = async (): Promise<typeof state> => {
```

After:
```ts
  const runSyncOnce = async (runOpts: { forceRefreshMedia: boolean }): Promise<typeof state> => {
```

- [ ] **Step 3: Pass forceRefreshMedia into syncBatch**

Find the `notionDestination.syncBatch(` call at `apps/desktop/src/main/index.ts:928`. Update the options object passed as the third argument:

Before:
```ts
              { onProgress: onNotionProgress }
```

After:
```ts
              { onProgress: onNotionProgress, forceRefreshMedia: runOpts.forceRefreshMedia }
```

- [ ] **Step 4: Update callers that no longer match the runSyncOnce signature**

Search for all `runSyncOnce(` invocations:

Run: `grep -n "runSyncOnce(" apps/desktop/src/main/index.ts`
Expected: at least one match — the call inside `runSync` (which now passes the option). Any other direct call without args becomes a type error; fix it by passing `{ forceRefreshMedia: false }`.

Update startBackgroundSync at `apps/desktop/src/main/index.ts:1135`:

Before:
```ts
    void runSync();
```

After (no change needed — `runSync` now accepts an optional arg):
```ts
    void runSync();
```

Update the scheduler at `apps/desktop/src/main/index.ts:1144-1146`:

Before:
```ts
    scheduleTimer = setTimeout(() => {
      void runSync().finally(schedule);
    }, intervalMs);
```

After (no change needed — same reason):
```ts
    scheduleTimer = setTimeout(() => {
      void runSync().finally(schedule);
    }, intervalMs);
```

Update the existing `archi:run-sync-now` handler at `apps/desktop/src/main/index.ts:1493-1497`:

Before:
```ts
  ipcMain.handle("archi:run-sync-now", async () => {
    const current = await runSync();
    schedule();
    return current;
  });
```

After (no change needed):
```ts
  ipcMain.handle("archi:run-sync-now", async () => {
    const current = await runSync();
    schedule();
    return current;
  });
```

- [ ] **Step 5: Add the new IPC handler**

Insert immediately after the `archi:run-sync-now` handler (which ends at index.ts:1497):

```ts
  ipcMain.handle("archi:refresh-notion-media", async () => {
    const current = await runSync({ forceRefreshMedia: true });
    schedule();
    return current;
  });
```

- [ ] **Step 6: Typecheck the desktop app**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: clean exit.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "desktop: forceRefreshMedia plumbing + archi:refresh-notion-media IPC"
```

---

## Task 8: Preload + renderer type declaration

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/env.d.ts`

- [ ] **Step 1: Expose refreshNotionMedia in preload**

In `apps/desktop/src/preload/index.ts`, locate the line at preload/index.ts:75:

Before:
```ts
  runSyncNow: (): Promise<SyncState> => ipcRenderer.invoke("archi:run-sync-now"),
  cancelSync: (): Promise<{ requested: boolean; message: string }> => ipcRenderer.invoke("archi:cancel-sync"),
```

After:
```ts
  runSyncNow: (): Promise<SyncState> => ipcRenderer.invoke("archi:run-sync-now"),
  refreshNotionMedia: (): Promise<SyncState> => ipcRenderer.invoke("archi:refresh-notion-media"),
  cancelSync: (): Promise<{ requested: boolean; message: string }> => ipcRenderer.invoke("archi:cancel-sync"),
```

- [ ] **Step 2: Add the type in env.d.ts**

In `apps/desktop/src/renderer/env.d.ts`, locate the lines at env.d.ts:49-50:

Before:
```ts
      runSyncNow: () => Promise<{ status: string; lastRunAt: string | null; nextRunAt: string | null; lastError: string | null }>;
      cancelSync: () => Promise<{ requested: boolean; message: string }>;
```

After:
```ts
      runSyncNow: () => Promise<{ status: string; lastRunAt: string | null; nextRunAt: string | null; lastError: string | null }>;
      refreshNotionMedia: () => Promise<{ status: string; lastRunAt: string | null; nextRunAt: string | null; lastError: string | null }>;
      cancelSync: () => Promise<{ requested: boolean; message: string }>;
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/renderer/env.d.ts
git commit -m "desktop: preload + renderer types for refreshNotionMedia"
```

---

## Task 9: Renderer handler + ConnectionsScreen button

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`

- [ ] **Step 1: Add the handler in App.tsx**

In `apps/desktop/src/renderer/App.tsx`, find the `runSyncNow` declaration at App.tsx:413. Insert this new handler immediately after `runSyncNow` ends (around App.tsx:442):

```ts
  const refreshNotionMedia = (): void => {
    if (isSyncing) {
      return;
    }
    const confirmed = window.confirm(
      "Re-write the page icon and cover image for every work in Notion. " +
        "This can take several minutes for large libraries and may overwrite any icons/covers you've customized. Continue?"
    );
    if (!confirmed) {
      return;
    }
    setIsSyncing(true);
    setIsCancelingSync(false);

    void window.archi
      .refreshNotionMedia()
      .then((next) => {
        setSyncState(next);
        refreshLists();
        refreshConnections();
      })
      .catch((error) => {
        setIsSyncing(false);
        setIsCancelingSync(false);
        setIpcError(
          `Refresh failed to start (${error instanceof Error ? error.message : "unknown error"}). ` +
            "If the main process is unhealthy, restart the dev server."
        );
      })
      .finally(() => {
        if (listRefreshTimerRef.current) {
          clearTimeout(listRefreshTimerRef.current);
          listRefreshTimerRef.current = null;
          isListRefreshQueuedRef.current = false;
        }
      });
  };
```

- [ ] **Step 2: Pass the handler down to ConnectionsScreen**

Find the spot in `App.tsx` where `ConnectionsScreen` is rendered. Run:

```bash
grep -n "ConnectionsScreen" apps/desktop/src/renderer/App.tsx
```

For each `<ConnectionsScreen ... />` JSX element, add the new prop `onRefreshNotionMedia={refreshNotionMedia}` to the list of props passed in (props are passed alphabetically or grouped — match the surrounding style).

Also add `refreshNotionMedia` to whatever dependency array / handler-bag exposes these handlers (search for `cancelSync,` near `runSyncNow,` — that's likely a handlers object; add `refreshNotionMedia,` there too).

- [ ] **Step 3: Add the prop + button in ConnectionsScreen**

In `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`, update the `Props` type at ConnectionsScreen.tsx:19-31:

Before:
```ts
type Props = {
  connections: Record<ConnectionProvider, ConnectionState>;
  cloudEnabled: boolean;
  notionTokenDraft: string;
  onNotionTokenDraftChange: (value: string) => void;
  onSetNotionToken: () => void;
  onConnect: (provider: ConnectionProvider) => void;
  onReconnect: (provider: ConnectionProvider) => void;
  onDisconnect: (provider: ConnectionProvider) => void;
  onTest: (provider: ConnectionProvider) => void;
  onChooseDeviceExportPath: () => void;
  onSetCloudEnabled: (enabled: boolean) => void;
};
```

After:
```ts
type Props = {
  connections: Record<ConnectionProvider, ConnectionState>;
  cloudEnabled: boolean;
  notionTokenDraft: string;
  onNotionTokenDraftChange: (value: string) => void;
  onSetNotionToken: () => void;
  onConnect: (provider: ConnectionProvider) => void;
  onReconnect: (provider: ConnectionProvider) => void;
  onDisconnect: (provider: ConnectionProvider) => void;
  onTest: (provider: ConnectionProvider) => void;
  onChooseDeviceExportPath: () => void;
  onSetCloudEnabled: (enabled: boolean) => void;
  onRefreshNotionMedia: () => void;
};
```

Update the destructuring at ConnectionsScreen.tsx:33-44:

Before:
```ts
export function ConnectionsScreen({
  connections,
  cloudEnabled,
  notionTokenDraft,
  onNotionTokenDraftChange,
  onSetNotionToken,
  onConnect,
  onReconnect,
  onDisconnect,
  onTest,
  onSetCloudEnabled
}: Props): JSX.Element {
```

After:
```ts
export function ConnectionsScreen({
  connections,
  cloudEnabled,
  notionTokenDraft,
  onNotionTokenDraftChange,
  onSetNotionToken,
  onConnect,
  onReconnect,
  onDisconnect,
  onTest,
  onSetCloudEnabled,
  onRefreshNotionMedia
}: Props): JSX.Element {
```

Add the button inside the Notion card's `connection-actions` block. Locate ConnectionsScreen.tsx:141-160 (the Notion card's actions div):

Before (the Disconnect button at the end):
```tsx
            {notion.canDisconnect ? (
              <button onClick={() => onDisconnect("notion")} disabled={notionBusy}>
                Disconnect
              </button>
            ) : null}
          </div>
        </article>
```

After:
```tsx
            {notion.canDisconnect ? (
              <button onClick={() => onDisconnect("notion")} disabled={notionBusy}>
                Disconnect
              </button>
            ) : null}
            {notionConnected ? (
              <button onClick={onRefreshNotionMedia} disabled={notionBusy}>
                Refresh Notion media
              </button>
            ) : null}
          </div>
        </article>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: clean exit. If there are errors about a missing prop on `<ConnectionsScreen>`, return to Step 2 and add `onRefreshNotionMedia={refreshNotionMedia}` to every render site.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/screens/ConnectionsScreen.tsx
git commit -m "desktop: Refresh Notion media button on Connections screen"
```

---

## Task 10: README

**Files:**
- Create: `packages/destination-notion/README.md`

- [ ] **Step 1: Create the README**

Create `packages/destination-notion/README.md`:

```markdown
# @archi/destination-notion

Notion destination for Archi. Provisions Library + Passages databases, upserts works and passages, and sets per-page icon and cover image.

## Icon and cover selection

Each Library page in Notion gets an `icon` and (when possible) a `cover`. Selection priority:

| Source                              | Icon                                         | Cover     |
| ----------------------------------- | -------------------------------------------- | --------- |
| `Work.coverImageUrl` present         | external image (same URL as cover)           | same URL  |
| `Work.coverImageUrl` missing         | emoji from the table below                   | (omitted) |

**Emoji fallback by `WorkType`:**

| Work type   | Emoji |
| ----------- | ----- |
| `book`      | 📚    |
| `article`   | 📰    |
| `periodical`| 🗞️    |
| `document`  | 📄    |
| `other`     | 📌    |
| (unknown)   | 📌    |

## Idempotency

On every sync, for each Library page:

- If the page was just created, write icon and cover in a single update (no read).
- Otherwise, read the page's current icon/cover. If they already match the desired values, no update is sent. Otherwise, send a single update with only the fields that differ.
- We **do not** clear an existing cover when a work's URL disappears on a normal sync. (Use the force refresh below if you want to clear.)

The Notion page itself is the source of truth for "have we written this already." We do not persist a separate write-log locally.

## Force refresh

Click **"Refresh Notion media"** on the Connections screen (in the Notion card's action row) to re-write icon and cover for every Library page, regardless of current state. Use this when:

- You changed the cover URL source upstream and want to propagate immediately.
- A previously-customized page should be reset to the Archi default.

The force-refresh action runs a normal sync internally — progress is reported through the same UI as "Sync now."

## URL rejection

If Notion rejects an external image URL (404, hotlink protection, image too large, invalid URL), the page falls back to its emoji icon for the work type and no cover. The sync continues for the remaining works.

## Known limitations

- **Trust-on-first-write.** If you manually change an icon or cover in Notion, the next sync will overwrite it. We may revisit this if a future spec introduces per-page write-provenance tracking.
- **Single URL source.** This package uses whatever `Work.coverImageUrl` the upstream source provides. A separate "media resolver" spec (planned) will add ISBN lookup, OpenGraph image scraping, and favicon resolution to populate URLs for works that lack one.
```

- [ ] **Step 2: Commit**

```bash
git add packages/destination-notion/README.md
git commit -m "notion-destination: README covering icon/cover selection + force refresh"
```

---

## Task 11: Manual verification

This is the final task. No code changes — confirm end-to-end behavior in a real Notion workspace before declaring done.

- [ ] **Step 1: Run the full quality gate**

```bash
pnpm typecheck
pnpm test
pnpm lint
```

Expected: all three pass.

- [ ] **Step 2: Run the desktop app against a scratch Notion workspace**

```bash
pnpm dev
```

In the app:
1. Connect Notion using a PAT for a scratch workspace.
2. Connect Kindle (or trigger a device-export sync — at minimum one work with a `coverImageUrl` and one without).
3. Click **Sync now**.

- [ ] **Step 3: Verify in Notion**

Open the auto-created Library database. For each Library page:

- [ ] Book with cover URL: image icon (small thumbnail) + full-width cover image at the top of the page.
- [ ] Book without cover URL: 📚 icon, no cover image area.

- [ ] **Step 4: Verify idempotency**

Click **Sync now** again. Open the same pages — they should look identical with no visible re-render flicker. Check the dev console / logs: there should be no `pages.update` calls scoped to icon/cover for unchanged works (verifiable by adding a temporary `console.log` inside `applyPageMedia`'s update branches if uncertain; remove before final commit).

- [ ] **Step 5: Verify force refresh**

In Notion, manually change one Library page's icon to a custom emoji (e.g., ⭐). Click **Sync now** in the app — confirm the icon reverts to the image-or-📚 default (documented trust-on-first-write behavior).

Then click **Refresh Notion media** on the Connections screen. Confirm the dialog. Confirm every Library page's icon and cover are re-rendered (Notion briefly shows a loading state on each).

- [ ] **Step 6: Verify URL-rejection fallback (best-effort, optional)**

If you can stage a work with a bogus `coverImageUrl` (e.g., `https://example.invalid/missing.jpg`), run a sync and confirm the page ends up with the emoji icon for its work type and no cover, without failing the whole sync. If staging this is hard, skip — the unit tests cover the policy.

- [ ] **Step 7: PR**

```bash
git push -u origin <your-branch>
gh pr create --title "Notion page icon + cover with idempotency" --body "$(cat <<'EOF'
## Summary
- Sets Notion page `icon` and `cover` on Library pages: image when `Work.coverImageUrl` is present, emoji fallback by work type otherwise.
- Idempotent — no `pages.update` for media when current matches desired. New-page short-circuit avoids the read entirely.
- Adds a "Refresh Notion media" button on the Connections screen to force a re-write.
- Notion URL-rejection (validation errors mentioning the image URL) falls back to the emoji icon for that page; sync continues.

## Test plan
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm lint`
- [x] Manual: scratch Notion workspace shows expected icon/cover for book-with-URL and book-without-URL
- [x] Manual: re-sync is visually quiet (no flicker, no extra updates)
- [x] Manual: user-customized icon is overwritten on normal sync (documented behavior)
- [x] Manual: "Refresh Notion media" re-writes all pages

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (for the executing agent)

The plan covers:

- ✅ **Spec §Goals — meaningful icon after sync, cover when URL present, idempotent re-runs, force-refresh action, URL-rejection fallback.** Tasks 1–10 collectively.
- ✅ **Spec §Success criteria** — Tasks 2, 3, 6 unit tests verify the idempotency and force claims; Task 11 manual checks verify in a real workspace.
- ✅ **Spec §Approach §Component changes 1–5** — Task 1 (chooseMedia + emojiFor), Tasks 2–4 (applyPageMedia + isMediaUrlRejection), Task 5 (NotionSyncBatchOptions, syncBatch, upsertLibraryWork integration, applyMediaForWork helper with fallback).
- ✅ **Spec §IPC + UI surface** — Task 7 (IPC + runSync option), Task 8 (preload + types), Task 9 (App.tsx handler + ConnectionsScreen button + confirm dialog).
- ✅ **Spec §Data flow** — Task 5 realizes the documented order; Task 6 tests the catch policy.
- ✅ **Spec §Error handling** — Task 4 (regex), Task 5 (fallback wrapper), Task 6 (policy tests).
- ✅ **Spec §Testing** — Tasks 1, 2, 3, 4, 6 cover all 13 documented test scenarios; Task 11 covers manual verification.
- ✅ **Spec §README** — Task 10.

Type-signature consistency check: `chooseMedia`, `applyPageMedia`, `MediaNotionClient`, `DesiredIcon`, `DesiredMedia`, `ApplyPageMediaOptions`, `isMediaUrlRejection`, `emojiFor` are all defined in Task 1/2/4 and used consistently thereafter. `applyMediaForWork` is private to the `NotionDestination` class (Task 5).

Placeholder scan: no TBD/TODO strings. All steps include concrete code or commands.
