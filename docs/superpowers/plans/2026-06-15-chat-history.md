# Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Archi chat conversations to a local SQLite database and surface them in a collapsible history rail inside the Chat screen.

**Architecture:** A new `@archi/chat`-internal persistence module (`ChatStore`) wraps a dedicated `chat.sqlite` file using Better-SQLite3. `ChatService.runTurn` writes user + assistant message pairs in a transaction on terminal turn states. Four new IPC channels expose list / load / rename / delete. The renderer adds a `useChatHistory` hook and a `ChatHistoryRail` component beside the existing transcript; `ChatScreen` carries a `conversationIdRef` to thread the same id through follow-up turns.

**Tech Stack:** TypeScript, Better-SQLite3 11.x (WAL), Electron main + preload, React 18, Vitest. No new dependencies — Better-SQLite3 is already wired with the Electron-rebuild script.

**Spec:** `docs/superpowers/specs/2026-06-15-chat-history-design.md` (commit `0b3c321`).

**Worktree:** `/Users/benjaminloschen/Projects/archi/.claude/worktrees/chat-history` on branch `chat-history`. Branched from `main` at `834c090`.

**Commit prefix:** `chat-history:`.

---

## File Map

### New files

| Path | Responsibility |
|---|---|
| `packages/chat/src/persistence/chatStore.ts` | `ChatStore` class — Better-SQLite3 wrapper with create/append/list/load/rename/delete + transactional turn writes. |
| `packages/chat/src/persistence/migrations.ts` | Ordered migration array (mirrors `packages/core/src/db/migrations.ts` pattern). Holds `001_init.sql` inline. |
| `packages/chat/src/persistence/openChatDatabase.ts` | `openChatDatabase(path)` — opens SQLite, sets WAL pragma, runs migrations. |
| `packages/chat/tests/chatStore.test.ts` | Vitest unit tests against an in-memory DB (`:memory:`). |
| `packages/chat/tests/chatService.persistence.test.ts` | Integration tests for `ChatService.runTurn` with a `ChatStore` injected. |
| `apps/desktop/src/renderer/hooks/useChatHistory.ts` | Loads list, subscribes to `historyChanged`, exposes rename/delete handlers. |
| `apps/desktop/src/renderer/components/chat/ChatHistoryRail.tsx` | Left rail container — group headers, scroll list, collapse toggle, empty state. |
| `apps/desktop/src/renderer/components/chat/ChatHistoryItem.tsx` | Single row with inline rename input + kebab menu. |
| `apps/desktop/src/renderer/components/chat/ChatHistoryDeleteModal.tsx` | Delete-confirm dialog. |
| `apps/desktop/src/renderer/styles/chat-history.css` | Rail layout, hover/active states, collapsed dots, modal — uses design-system tokens. |
| `docs/qa/chat-history.md` | Manual QA checklist. |

### Modified files

| Path | Change |
|---|---|
| `packages/chat/src/types.ts` | Add `ChatConversation`, `ChatStoredMessage`. Extend `ChatTurnRequest` with `conversationId?`. Extend `ChatTurnDoneEvent` + `ChatTurnErrorEvent` + `ChatTurnAbortedEvent` with `conversationId`. |
| `packages/chat/src/chatService.ts` | Accept `store?: ChatStore` in constructor. On every terminal sink emission, write the turn pair + emit `conversationId`. |
| `packages/chat/src/index.ts` | Export `ChatStore`, `openChatDatabase`, and the new types. |
| `packages/chat/package.json` | Add `better-sqlite3` and `@types/better-sqlite3` to dependencies (mirrors `@archi/search`). |
| `apps/desktop/src/main/chatModule.ts` | Open `chat.sqlite` under `userData`, construct `ChatStore`, pass to `ChatService`. Expose store on the module. |
| `apps/desktop/src/main/ipc/chatIpc.ts` | Register four new handlers + emit `archi:chat:historyChanged` on mutations. Forward `conversationId` in done/error/aborted broadcasts. |
| `apps/desktop/src/main/index.ts` | Pass `userDataPath` to `createChatModule`. |
| `apps/desktop/src/preload/index.ts` | Expose `listConversations`, `loadConversation`, `renameConversation`, `deleteConversation`, `onHistoryChanged`. |
| `apps/desktop/src/renderer/env.d.ts` | Type the new preload methods. |
| `apps/desktop/src/renderer/hooks/useChatTurn.ts` | Track returned `conversationId` from done/error events; expose via result. |
| `apps/desktop/src/renderer/screens/ChatScreen.tsx` | Two-pane layout. `conversationIdRef`. Wire rail + resume + new-chat. |
| `apps/desktop/src/renderer/main.tsx` | Import `./styles/chat-history.css`. |

---

## Task 1: Add Better-SQLite3 dependency to @archi/chat

**Files:**
- Modify: `packages/chat/package.json`

- [ ] **Step 1: Update package.json**

Replace the `dependencies` block in `packages/chat/package.json`:

```json
  "dependencies": {
    "@archi/search": "workspace:*",
    "better-sqlite3": "^11.10.0"
  },
  "devDependencies": {
    "vitest": "^2.1.8",
    "@types/better-sqlite3": "^7.6.12"
  }
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 3: Verify rebuild script picks up the new package**

Run: `pnpm -F @archi/desktop rebuild:native`
Expected: rebuild completes; `apps/desktop/node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists.

If your project uses a different rebuild script name, check `apps/desktop/package.json` and run the actual one. Typecheck currently doesn't depend on the native build, so this is a sanity check.

- [ ] **Step 4: Commit**

```bash
git add packages/chat/package.json pnpm-lock.yaml
git commit -m "chat-history: add better-sqlite3 dep to @archi/chat"
```

---

## Task 2: ChatStore schema + migrations module

Mirrors `packages/core/src/db/client.ts` + `packages/core/src/db/migrations.ts` so engineers reading the codebase find one shape of "wrap better-sqlite3 + a migrations table".

**Files:**
- Create: `packages/chat/src/persistence/migrations.ts`
- Create: `packages/chat/src/persistence/openChatDatabase.ts`

- [ ] **Step 1: Write the migrations module**

Create `packages/chat/src/persistence/migrations.ts`:

```ts
export type Migration = {
  version: number;
  sql: string;
};

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE conversations (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        model_name  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX conversations_updated ON conversations(updated_at DESC);

      CREATE TABLE messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content         TEXT NOT NULL,
        citations_json  TEXT,
        status          TEXT NOT NULL,
        error_code      TEXT,
        duration_ms     INTEGER,
        created_at      INTEGER NOT NULL
      );
      CREATE INDEX messages_conversation ON messages(conversation_id, created_at);
    `,
  },
];
```

- [ ] **Step 2: Write the open-database module**

Create `packages/chat/src/persistence/openChatDatabase.ts`:

```ts
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations.js";

export type ChatDatabase = Database.Database;

export function openChatDatabase(path: string): ChatDatabase {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

function applyMigrations(db: ChatDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const existingRows = db.prepare("SELECT version FROM migrations").all() as Array<{ version: number }>;
  const existing = new Set(existingRows.map((r) => r.version));
  const transaction = db.transaction(() => {
    for (const m of MIGRATIONS) {
      if (existing.has(m.version)) continue;
      db.exec(m.sql);
      db.prepare("INSERT INTO migrations(version, applied_at) VALUES (?, ?)").run(
        m.version,
        new Date().toISOString()
      );
    }
  });
  transaction();
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @archi/chat typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/chat/src/persistence/
git commit -m "chat-history: schema + open helper for chat.sqlite"
```

---

## Task 3: ChatStore — createConversation + listConversations (TDD)

We build `ChatStore` incrementally, each method test-first. This step covers create + list. Listing comes early so the test asserts the row exists after creation.

**Files:**
- Create: `packages/chat/tests/chatStore.test.ts`
- Create: `packages/chat/src/persistence/chatStore.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/chat/tests/chatStore.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { openChatDatabase } from "../src/persistence/openChatDatabase.js";
import { ChatStore } from "../src/persistence/chatStore.js";

function makeStore(): ChatStore {
  const db = openChatDatabase(":memory:");
  return new ChatStore(db);
}

describe("ChatStore.createConversation + listConversations", () => {
  it("creates a row and lists it back", () => {
    const store = makeStore();
    const conv = store.createConversation({
      title: "Hello there",
      modelName: "llama3.1:8b",
      now: 1_700_000_000_000,
    });
    expect(conv.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(conv.title).toBe("Hello there");
    expect(conv.modelName).toBe("llama3.1:8b");
    expect(conv.createdAt).toBe(1_700_000_000_000);
    expect(conv.updatedAt).toBe(1_700_000_000_000);

    const list = store.listConversations();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(conv.id);
  });

  it("trims title to 60 chars with ellipsis", () => {
    const store = makeStore();
    const conv = store.createConversation({
      title: "x".repeat(120),
      modelName: "m",
      now: 1,
    });
    expect(conv.title).toBe("x".repeat(60) + "…");
  });

  it("sorts listConversations by updated_at DESC", () => {
    const store = makeStore();
    const a = store.createConversation({ title: "A", modelName: "m", now: 1 });
    const b = store.createConversation({ title: "B", modelName: "m", now: 2 });
    const c = store.createConversation({ title: "C", modelName: "m", now: 3 });
    const ids = store.listConversations().map((r) => r.id);
    expect(ids).toEqual([c.id, b.id, a.id]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @archi/chat test -- chatStore`
Expected: FAIL — `ChatStore is not defined` (or similar import failure).

- [ ] **Step 3: Implement the minimum that passes**

Create `packages/chat/src/persistence/chatStore.ts`:

```ts
import type { ChatDatabase } from "./openChatDatabase.js";
import { randomUUID } from "node:crypto";

const TITLE_MAX = 60;

export type ChatConversation = {
  id: string;
  title: string;
  modelName: string;
  createdAt: number;
  updatedAt: number;
};

function clipTitle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= TITLE_MAX) return trimmed;
  return trimmed.slice(0, TITLE_MAX) + "…";
}

function rowToConversation(row: {
  id: string;
  title: string;
  model_name: string;
  created_at: number;
  updated_at: number;
}): ChatConversation {
  return {
    id: row.id,
    title: row.title,
    modelName: row.model_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ChatStore {
  constructor(private readonly db: ChatDatabase) {}

  createConversation(opts: {
    title: string;
    modelName: string;
    now: number;
  }): ChatConversation {
    const id = randomUUID();
    const title = clipTitle(opts.title) || "Untitled";
    this.db
      .prepare(
        `INSERT INTO conversations(id, title, model_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, title, opts.modelName, opts.now, opts.now);
    return {
      id,
      title,
      modelName: opts.modelName,
      createdAt: opts.now,
      updatedAt: opts.now,
    };
  }

  listConversations(): ChatConversation[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, model_name, created_at, updated_at
         FROM conversations
         ORDER BY updated_at DESC`
      )
      .all() as Array<{
      id: string;
      title: string;
      model_name: string;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map(rowToConversation);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @archi/chat test -- chatStore`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/persistence/chatStore.ts packages/chat/tests/chatStore.test.ts
git commit -m "chat-history: ChatStore.createConversation + listConversations"
```

---

## Task 4: ChatStore.appendTurn — transactional user + assistant write (TDD)

`appendTurn` writes a user message and an assistant message in a single transaction and bumps `updated_at`. We cover the happy path, atomicity, and the assistant fields (`citations_json`, `status`, `error_code`, `duration_ms`).

**Files:**
- Modify: `packages/chat/tests/chatStore.test.ts`
- Modify: `packages/chat/src/persistence/chatStore.ts`

- [ ] **Step 1: Add the failing tests**

Append to `packages/chat/tests/chatStore.test.ts`:

```ts
describe("ChatStore.appendTurn", () => {
  it("writes user + assistant rows and bumps updated_at", () => {
    const store = makeStore();
    const c = store.createConversation({ title: "T", modelName: "m", now: 100 });
    store.appendTurn({
      conversationId: c.id,
      now: 200,
      userMessage: { content: "what is it?" },
      assistantMessage: {
        content: "an answer",
        citations: ["p1", "p2"],
        status: "done",
        durationMs: 1234,
      },
    });
    const loaded = store.loadConversation(c.id);
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0]?.role).toBe("user");
    expect(loaded.messages[0]?.content).toBe("what is it?");
    expect(loaded.messages[1]?.role).toBe("assistant");
    expect(loaded.messages[1]?.content).toBe("an answer");
    expect(loaded.messages[1]?.citations).toEqual(["p1", "p2"]);
    expect(loaded.messages[1]?.status).toBe("done");
    expect(loaded.messages[1]?.durationMs).toBe(1234);
    expect(loaded.conversation.updatedAt).toBe(200);
  });

  it("stores null citations_json when no citations are passed", () => {
    const store = makeStore();
    const c = store.createConversation({ title: "T", modelName: "m", now: 1 });
    store.appendTurn({
      conversationId: c.id,
      now: 2,
      userMessage: { content: "q" },
      assistantMessage: {
        content: "a",
        citations: [],
        status: "skipped",
        durationMs: 10,
      },
    });
    const loaded = store.loadConversation(c.id);
    expect(loaded.messages[1]?.citations).toEqual([]);
  });

  it("persists assistant errors with code", () => {
    const store = makeStore();
    const c = store.createConversation({ title: "T", modelName: "m", now: 1 });
    store.appendTurn({
      conversationId: c.id,
      now: 2,
      userMessage: { content: "q" },
      assistantMessage: {
        content: "",
        citations: [],
        status: "error",
        errorCode: "ollama_unreachable",
        durationMs: 5,
      },
    });
    const loaded = store.loadConversation(c.id);
    expect(loaded.messages[1]?.status).toBe("error");
    expect(loaded.messages[1]?.errorCode).toBe("ollama_unreachable");
  });

  it("rolls back both inserts if assistant insert fails", () => {
    const store = makeStore();
    const c = store.createConversation({ title: "T", modelName: "m", now: 1 });
    expect(() =>
      store.appendTurn({
        conversationId: c.id,
        now: 2,
        userMessage: { content: "q" },
        // role check will fail on the assistant row's invalid status,
        // forcing the transaction to roll back the user insert too.
        assistantMessage: {
          content: "a",
          citations: [],
          status: "bogus" as never,
          durationMs: 1,
        },
      })
    ).toThrow();
    const loaded = store.loadConversation(c.id);
    expect(loaded.messages).toHaveLength(0);
    // updated_at should also NOT have been bumped
    expect(loaded.conversation.updatedAt).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @archi/chat test -- chatStore`
Expected: FAIL — `appendTurn is not a function` (or `loadConversation is not a function`).

- [ ] **Step 3: Implement appendTurn + loadConversation (minimum to pass)**

Add to `packages/chat/src/persistence/chatStore.ts` — replace the current class body with this extended version (keep imports + `clipTitle` + `rowToConversation` from Task 3):

```ts
const ALLOWED_STATUSES = new Set(["done", "error", "aborted", "skipped"]);

export type ChatStoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: string[];
  status: "done" | "error" | "aborted" | "skipped";
  errorCode: string | null;
  durationMs: number | null;
  createdAt: number;
};

export type LoadedConversation = {
  conversation: ChatConversation;
  messages: ChatStoredMessage[];
};

export type AppendTurnInput = {
  conversationId: string;
  now: number;
  userMessage: { content: string };
  assistantMessage: {
    content: string;
    citations: string[];
    status: "done" | "error" | "aborted" | "skipped";
    errorCode?: string;
    durationMs: number;
  };
};

export class ChatStore {
  constructor(private readonly db: ChatDatabase) {}

  createConversation(opts: {
    title: string;
    modelName: string;
    now: number;
  }): ChatConversation {
    const id = randomUUID();
    const title = clipTitle(opts.title) || "Untitled";
    this.db
      .prepare(
        `INSERT INTO conversations(id, title, model_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, title, opts.modelName, opts.now, opts.now);
    return {
      id,
      title,
      modelName: opts.modelName,
      createdAt: opts.now,
      updatedAt: opts.now,
    };
  }

  listConversations(): ChatConversation[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, model_name, created_at, updated_at
         FROM conversations
         ORDER BY updated_at DESC`
      )
      .all() as Array<{
      id: string;
      title: string;
      model_name: string;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map(rowToConversation);
  }

  loadConversation(id: string): LoadedConversation {
    const convRow = this.db
      .prepare(
        `SELECT id, title, model_name, created_at, updated_at
         FROM conversations WHERE id = ?`
      )
      .get(id) as
      | {
          id: string;
          title: string;
          model_name: string;
          created_at: number;
          updated_at: number;
        }
      | undefined;
    if (!convRow) {
      throw new Error(`Conversation not found: ${id}`);
    }
    const msgRows = this.db
      .prepare(
        `SELECT id, role, content, citations_json, status, error_code, duration_ms, created_at
         FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(id) as Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      citations_json: string | null;
      status: string;
      error_code: string | null;
      duration_ms: number | null;
      created_at: number;
    }>;
    return {
      conversation: rowToConversation(convRow),
      messages: msgRows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        citations: r.citations_json ? (JSON.parse(r.citations_json) as string[]) : [],
        status: r.status as ChatStoredMessage["status"],
        errorCode: r.error_code,
        durationMs: r.duration_ms,
        createdAt: r.created_at,
      })),
    };
  }

  appendTurn(input: AppendTurnInput): void {
    if (!ALLOWED_STATUSES.has(input.assistantMessage.status)) {
      throw new Error(`Invalid status: ${input.assistantMessage.status}`);
    }
    const userId = randomUUID();
    const assistantId = randomUUID();
    const userCreatedAt = input.now;
    // Ensure ordering: assistant's created_at is at least userCreatedAt+1
    // so a load ordered by created_at preserves user-then-assistant.
    const assistantCreatedAt = input.now + 1;
    const citationsJson =
      input.assistantMessage.citations.length === 0
        ? null
        : JSON.stringify(input.assistantMessage.citations);
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO messages(id, conversation_id, role, content, citations_json, status, error_code, duration_ms, created_at)
           VALUES (?, ?, 'user', ?, NULL, 'done', NULL, NULL, ?)`
        )
        .run(userId, input.conversationId, input.userMessage.content, userCreatedAt);
      this.db
        .prepare(
          `INSERT INTO messages(id, conversation_id, role, content, citations_json, status, error_code, duration_ms, created_at)
           VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          assistantId,
          input.conversationId,
          input.assistantMessage.content,
          citationsJson,
          input.assistantMessage.status,
          input.assistantMessage.errorCode ?? null,
          input.assistantMessage.durationMs,
          assistantCreatedAt
        );
      this.db
        .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
        .run(assistantCreatedAt, input.conversationId);
    });
    tx();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @archi/chat test -- chatStore`
Expected: 7 passing (3 from Task 3 + 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/persistence/chatStore.ts packages/chat/tests/chatStore.test.ts
git commit -m "chat-history: ChatStore.appendTurn writes turn pair in tx"
```

---

## Task 5: ChatStore.renameConversation + deleteConversation (TDD)

**Files:**
- Modify: `packages/chat/tests/chatStore.test.ts`
- Modify: `packages/chat/src/persistence/chatStore.ts`

- [ ] **Step 1: Add the failing tests**

Append to `packages/chat/tests/chatStore.test.ts`:

```ts
describe("ChatStore.renameConversation", () => {
  it("updates the title, trimming + clipping to 60 chars", () => {
    const store = makeStore();
    const c = store.createConversation({ title: "T", modelName: "m", now: 1 });
    store.renameConversation(c.id, "  " + "y".repeat(80) + "  ");
    const loaded = store.loadConversation(c.id);
    expect(loaded.conversation.title).toBe("y".repeat(60) + "…");
  });

  it("throws if the conversation does not exist", () => {
    const store = makeStore();
    expect(() => store.renameConversation("nope", "x")).toThrow();
  });
});

describe("ChatStore.deleteConversation", () => {
  it("removes the conversation and its messages", () => {
    const store = makeStore();
    const c = store.createConversation({ title: "T", modelName: "m", now: 1 });
    store.appendTurn({
      conversationId: c.id,
      now: 2,
      userMessage: { content: "q" },
      assistantMessage: {
        content: "a",
        citations: [],
        status: "done",
        durationMs: 1,
      },
    });
    store.deleteConversation(c.id);
    expect(store.listConversations()).toEqual([]);
    expect(() => store.loadConversation(c.id)).toThrow();
  });

  it("is a no-op for unknown ids (no throw)", () => {
    const store = makeStore();
    expect(() => store.deleteConversation("ghost")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @archi/chat test -- chatStore`
Expected: FAIL — `renameConversation is not a function`.

- [ ] **Step 3: Add the methods**

Add inside the `ChatStore` class in `packages/chat/src/persistence/chatStore.ts`, after `appendTurn`:

```ts
  renameConversation(id: string, title: string): void {
    const clipped = clipTitle(title) || "Untitled";
    const result = this.db
      .prepare(`UPDATE conversations SET title = ? WHERE id = ?`)
      .run(clipped, id);
    if (result.changes === 0) {
      throw new Error(`Conversation not found: ${id}`);
    }
  }

  deleteConversation(id: string): void {
    this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
    // messages cascade via FK
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @archi/chat test -- chatStore`
Expected: 11 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/persistence/chatStore.ts packages/chat/tests/chatStore.test.ts
git commit -m "chat-history: ChatStore.renameConversation + deleteConversation"
```

---

## Task 6: Migration idempotence test

**Files:**
- Modify: `packages/chat/tests/chatStore.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `packages/chat/tests/chatStore.test.ts`:

```ts
describe("openChatDatabase migrations", () => {
  it("applies migrations once; running twice is a no-op", () => {
    const db = openChatDatabase(":memory:");
    const after1 = db.prepare("SELECT COUNT(*) AS n FROM migrations").get() as { n: number };
    expect(after1.n).toBe(1);
    // Re-apply by calling open again on the same handle would require a re-init path;
    // instead, run the same migration logic by manually invoking it twice.
    // Simulate the second open by repeating the migration logic:
    const store = new ChatStore(db);
    store.createConversation({ title: "x", modelName: "m", now: 1 });
    // We re-open in the same process: the WAL file shares state, so opening a NEW
    // handle to ":memory:" gives a *different* in-memory DB. Instead use a file path.
  });
});
```

Wait — that approach is brittle because `:memory:` databases aren't shared between handles. Use a temp file instead.

Replace the block above with this:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("openChatDatabase migrations", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "archi-chat-test-"));
  });

  it("applies the v1 migration once and is idempotent across opens", () => {
    const path = join(tmpDir, "chat.sqlite");
    const db1 = openChatDatabase(path);
    const count1 = db1
      .prepare("SELECT COUNT(*) AS n FROM migrations")
      .get() as { n: number };
    expect(count1.n).toBe(1);
    db1.close();

    const db2 = openChatDatabase(path);
    const count2 = db2
      .prepare("SELECT COUNT(*) AS n FROM migrations")
      .get() as { n: number };
    expect(count2.n).toBe(1);
    db2.close();

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm -F @archi/chat test -- chatStore`
Expected: all tests passing including the new idempotence test.

(If it fails, the migration logic in Task 2 has a bug. Fix it there before continuing — do not paper over with the test.)

- [ ] **Step 3: Commit**

```bash
git add packages/chat/tests/chatStore.test.ts
git commit -m "chat-history: assert migrations are idempotent across opens"
```

---

## Task 7: Export persistence module + add types

**Files:**
- Modify: `packages/chat/src/types.ts`
- Modify: `packages/chat/src/index.ts`

- [ ] **Step 1: Add new types**

In `packages/chat/src/types.ts`, after the `ChatTurnTokenEvent` type and before `ChatTurnAbortedEvent`, replace `ChatTurnDoneEvent`, `ChatTurnErrorEvent`, `ChatTurnAbortedEvent`, and `ChatTurnRequest` so they carry `conversationId`. Replace the relevant block with:

```ts
export type ChatTurnRequest = {
  turnId: string;
  conversationId?: string;
  question: string;
  history: ChatMessage[];
  modelName: string;
  options?: ChatTurnOptions;
};

export type ChatTurnDoneEvent = {
  turnId: string;
  conversationId: string;
  citations: SearchResult[];
  durationMs: number;
  skipped?: boolean;
  skipReason?: "no_passages";
};

export type ChatTurnErrorEvent = {
  turnId: string;
  conversationId: string | null;
  code: "ollama_unreachable" | "model_missing" | "context_overflow" | "persistence_failed" | "unknown";
  message: string;
};

export type ChatTurnAbortedEvent = {
  turnId: string;
  conversationId: string | null;
};
```

(Note `persistence_failed` is added to the error code union.)

- [ ] **Step 2: Update the index**

Replace `packages/chat/src/index.ts` with:

```ts
export type {
  ChatDelta,
  ChatMessage,
  ChatRequestMessages,
  ChatTurnAbortedEvent,
  ChatTurnDoneEvent,
  ChatTurnErrorEvent,
  ChatTurnOptions,
  ChatTurnRequest,
  ChatTurnTokenEvent,
  DetectResult,
  ModelInfo,
  PullProgress,
} from "./types.js";
export {
  DEFAULT_TOP_K,
  HISTORY_WINDOW_TURNS,
  MAX_PASSAGE_BODY_TOKENS,
  SYSTEM_PROMPT_VERSION,
} from "./types.js";
export { SYSTEM_PROMPT } from "./prompt/systemPrompt.js";
export { buildRagPrompt } from "./prompt/buildRagPrompt.js";
export type { ChatRequest, LLMClient } from "./llmClient.js";
export {
  RECOMMENDED_MODELS,
  defaultRecommendation,
  isRecommended,
  type RecommendedModel,
} from "./recommendations.js";
export { OllamaClient } from "./ollama/ollamaClient.js";
export { ChatService, type ChatEventSink, type ChatServiceEvent } from "./chatService.js";
export {
  ChatStore,
  type ChatConversation,
  type ChatStoredMessage,
  type LoadedConversation,
  type AppendTurnInput,
} from "./persistence/chatStore.js";
export { openChatDatabase, type ChatDatabase } from "./persistence/openChatDatabase.js";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @archi/chat typecheck`
Expected: errors in `chatService.ts` because `ChatTurnDoneEvent.conversationId` is now required but the service doesn't pass it. That's Task 8.

To unblock typecheck on just this commit, also touch `chatService.ts` minimally: replace each `sink({ type: "done", turnId, … })` with `sink({ type: "done", turnId, conversationId: req.conversationId ?? "", … })` and each `sink({ type: "error", turnId, … })` with `sink({ type: "error", turnId, conversationId: req.conversationId ?? null, … })` and each `sink({ type: "aborted", turnId })` with `sink({ type: "aborted", turnId, conversationId: req.conversationId ?? null })`. We replace these temporary values properly in Task 8.

- [ ] **Step 4: Typecheck again**

Run: `pnpm -F @archi/chat typecheck`
Expected: no errors.

- [ ] **Step 5: Run existing tests**

Run: `pnpm -F @archi/chat test`
Expected: all previously-passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/types.ts packages/chat/src/index.ts packages/chat/src/chatService.ts
git commit -m "chat-history: thread conversationId through chat event types"
```

---

## Task 8: Wire ChatStore into ChatService (TDD)

`ChatService` gains an optional `store: ChatStore`. When set:
- If `req.conversationId` is missing, create a new conversation row using the first 60 chars of `req.question` as the title, then proceed.
- On every terminal sink emission (`done`, `error`, `aborted`), call `store.appendTurn` with the user message + assistant message reflecting the final state, then surface the `conversationId` on the outgoing event.
- A persistence failure becomes an `error` event with code `persistence_failed`.

**Files:**
- Create: `packages/chat/tests/chatService.persistence.test.ts`
- Modify: `packages/chat/src/chatService.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/chat/tests/chatService.persistence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ChatService } from "../src/chatService.js";
import { ChatStore } from "../src/persistence/chatStore.js";
import { openChatDatabase } from "../src/persistence/openChatDatabase.js";
import type { LLMClient } from "../src/llmClient.js";
import type { ChatDelta, ChatTurnRequest } from "../src/types.js";

function passage(id: string): import("@archi/search").SearchResult {
  return {
    passageId: id,
    body: "body",
    snippet: "",
    work: { id: `w-${id}`, displayTitle: "T", creator: "C" },
    labels: [],
    isStarred: false,
    scores: { fused: 0 },
    matchedVia: "vector" as const,
  };
}

function makeLLM(stream: ChatDelta[]): LLMClient {
  return {
    detect: async () => ({ status: "ready", modelCount: 1 }),
    listModels: async () => [],
    pullModel: async function* () {},
    chat: async function* () {
      for (const d of stream) yield d;
    },
  } as unknown as LLMClient;
}

function makeSearch(results: unknown[]) {
  return {
    query: async () => ({
      query: "",
      filters: {},
      results,
      totalCandidates: results.length,
      durationMs: 1,
    }),
  };
}

function makeRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    turnId: "t1",
    question: "What is wisdom?",
    history: [],
    modelName: "llama3.1:8b",
    ...overrides,
  };
}

function makeStore(): ChatStore {
  return new ChatStore(openChatDatabase(":memory:"));
}

describe("ChatService persistence", () => {
  it("creates a conversation on first turn when no conversationId is provided", async () => {
    const store = makeStore();
    const events: Array<{ type: string; conversationId?: string | null }> = [];
    const passages = [passage("p1")];
    const service = new ChatService({
      search: makeSearch(passages) as never,
      llm: makeLLM([{ text: "hi", done: true }]),
      store,
    });
    await service.runTurn(makeRequest(), (e) => events.push(e));
    const done = events.find((e) => e.type === "done");
    expect(done?.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    const list = store.listConversations();
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("What is wisdom?");
  });

  it("reuses the provided conversationId on follow-up turns", async () => {
    const store = makeStore();
    const conv = store.createConversation({
      title: "Pre-existing",
      modelName: "m",
      now: 1,
    });
    const events: Array<{ type: string; conversationId?: string | null }> = [];
    const service = new ChatService({
      search: makeSearch([passage("p1")]) as never,
      llm: makeLLM([{ text: "a", done: true }]),
      store,
    });
    await service.runTurn(
      makeRequest({ conversationId: conv.id }),
      (e) => events.push(e)
    );
    const done = events.find((e) => e.type === "done");
    expect(done?.conversationId).toBe(conv.id);
    const loaded = store.loadConversation(conv.id);
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[1]?.citations).toEqual(["p1"]);
  });

  it("persists the user + skipped assistant when no passages match", async () => {
    const store = makeStore();
    const events: Array<{ type: string; conversationId?: string | null }> = [];
    const service = new ChatService({
      search: makeSearch([]) as never,
      llm: makeLLM([]),
      store,
    });
    await service.runTurn(makeRequest(), (e) => events.push(e));
    const list = store.listConversations();
    expect(list).toHaveLength(1);
    const loaded = store.loadConversation(list[0]!.id);
    expect(loaded.messages[1]?.status).toBe("skipped");
  });

  it("persists the user + error assistant on llm failure", async () => {
    const store = makeStore();
    const llm = {
      detect: async () => ({ status: "ready", modelCount: 1 }),
      listModels: async () => [],
      pullModel: async function* () {},
      chat: async function* () {
        throw new Error("ECONNREFUSED");
      },
    } as unknown as LLMClient;
    const events: Array<{ type: string; conversationId?: string | null }> = [];
    const service = new ChatService({
      search: makeSearch([passage("p1")]) as never,
      llm,
      store,
    });
    await service.runTurn(makeRequest(), (e) => events.push(e));
    const err = events.find((e) => e.type === "error");
    expect(err?.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    const loaded = store.loadConversation((err as { conversationId: string }).conversationId);
    expect(loaded.messages[1]?.status).toBe("error");
    expect(loaded.messages[1]?.errorCode).toBe("ollama_unreachable");
  });

  it("works without a store (existing pre-persistence behavior)", async () => {
    const events: Array<{ type: string; conversationId?: string | null }> = [];
    const service = new ChatService({
      search: makeSearch([passage("p1")]) as never,
      llm: makeLLM([{ text: "x", done: true }]),
    });
    await service.runTurn(makeRequest(), (e) => events.push(e));
    const done = events.find((e) => e.type === "done");
    expect(done?.conversationId).toBe(""); // no store → empty string sentinel
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @archi/chat test -- chatService.persistence`
Expected: FAIL — `store` is not a supported constructor option (or events have empty `conversationId` even when a store is set).

- [ ] **Step 3: Replace ChatService with the persistence-aware version**

Replace the entire contents of `packages/chat/src/chatService.ts` with:

```ts
import type { SearchService, SearchResult } from "@archi/search";
import { buildRagPrompt } from "./prompt/buildRagPrompt.js";
import type { LLMClient } from "./llmClient.js";
import type { ChatStore } from "./persistence/chatStore.js";
import {
  DEFAULT_TOP_K,
  type ChatTurnAbortedEvent,
  type ChatTurnDoneEvent,
  type ChatTurnErrorEvent,
  type ChatTurnRequest,
  type ChatTurnTokenEvent,
} from "./types.js";

export type ChatServiceEvent =
  | ({ type: "token" } & ChatTurnTokenEvent)
  | ({ type: "done" } & ChatTurnDoneEvent)
  | ({ type: "error" } & ChatTurnErrorEvent)
  | ({ type: "aborted" } & ChatTurnAbortedEvent);

export type ChatEventSink = (event: ChatServiceEvent) => void;

const EMPTY_CONVERSATION_ID = "";

export class ChatService {
  private readonly search: SearchService;
  private readonly llm: LLMClient;
  private readonly store: ChatStore | null;
  private readonly active = new Map<string, AbortController>();

  constructor(opts: { search: SearchService; llm: LLMClient; store?: ChatStore }) {
    this.search = opts.search;
    this.llm = opts.llm;
    this.store = opts.store ?? null;
  }

  cancel(turnId: string): void {
    this.active.get(turnId)?.abort();
  }

  async runTurn(req: ChatTurnRequest, sink: ChatEventSink): Promise<void> {
    const { turnId } = req;
    const started = performance.now();
    const controller = new AbortController();
    this.active.set(turnId, controller);
    const tag = `[chat:${turnId.slice(0, 8)}]`;

    const conversationId = this.ensureConversationId(req);
    let assistantText = "";
    let citations: SearchResult[] = [];

    const persistTurn = (
      status: "done" | "error" | "aborted" | "skipped",
      opts: { errorCode?: string } = {}
    ): void => {
      if (!this.store || conversationId === EMPTY_CONVERSATION_ID) return;
      try {
        this.store.appendTurn({
          conversationId,
          now: Date.now(),
          userMessage: { content: req.question },
          assistantMessage: {
            content: assistantText,
            citations: citations.map((c) => c.passageId),
            status,
            errorCode: opts.errorCode,
            durationMs: Math.round(performance.now() - started),
          },
        });
      } catch (err) {
        console.error(`${tag} persistence write failed:`, err);
      }
    };

    try {
      console.log(`${tag} start — question="${req.question.slice(0, 80)}" model=${req.modelName}`);
      const topK = req.options?.topK ?? DEFAULT_TOP_K;
      const filters: Parameters<SearchService["query"]>[0]["filters"] = {};
      if (req.options?.includeArchived !== true) filters.isArchived = false;
      if (req.options?.includeHidden !== true) filters.isHidden = false;

      let searchResponse;
      try {
        searchResponse = await this.search.query({
          text: req.question,
          limit: topK,
          filters,
        });
      } catch (err) {
        console.error(`${tag} search threw:`, err);
        persistTurn("error", { errorCode: "unknown" });
        sink({
          type: "error",
          turnId,
          conversationId: conversationId || null,
          code: "unknown",
          message: `Search failed: ${(err as Error).message ?? String(err)}`,
        });
        return;
      }

      if (searchResponse.results.length === 0) {
        persistTurn("skipped");
        sink({
          type: "done",
          turnId,
          conversationId,
          citations: [],
          durationMs: Math.round(performance.now() - started),
          skipped: true,
          skipReason: "no_passages",
        });
        return;
      }

      citations = searchResponse.results;

      let prompt;
      try {
        prompt = buildRagPrompt(req.question, searchResponse.results, req.history);
      } catch (err) {
        console.error(`${tag} buildRagPrompt threw:`, err);
        persistTurn("error", { errorCode: "unknown" });
        sink({
          type: "error",
          turnId,
          conversationId: conversationId || null,
          code: "unknown",
          message: `Prompt build failed: ${(err as Error).message ?? String(err)}`,
        });
        return;
      }

      try {
        let tokenChunks = 0;
        for await (const delta of this.llm.chat({
          model: req.modelName,
          system: prompt.system,
          messages: prompt.messages,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) {
            persistTurn("aborted");
            sink({ type: "aborted", turnId, conversationId: conversationId || null });
            return;
          }
          if (delta.text) {
            if (tokenChunks === 0) {
              console.log(`${tag} first token after ${Math.round(performance.now() - started)}ms`);
            }
            tokenChunks++;
            assistantText += delta.text;
            sink({ type: "token", turnId, delta: delta.text });
          }
          if (delta.done) break;
        }
        if (controller.signal.aborted) {
          persistTurn("aborted");
          sink({ type: "aborted", turnId, conversationId: conversationId || null });
          return;
        }
      } catch (err) {
        if (controller.signal.aborted) {
          persistTurn("aborted");
          sink({ type: "aborted", turnId, conversationId: conversationId || null });
          return;
        }
        const code = classifyError(err);
        persistTurn("error", { errorCode: code });
        sink({
          type: "error",
          turnId,
          conversationId: conversationId || null,
          code,
          message: (err as Error).message ?? "Unknown error",
        });
        return;
      }

      persistTurn("done");
      sink({
        type: "done",
        turnId,
        conversationId,
        citations,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (err) {
      console.error(`${tag} runTurn threw unexpectedly:`, err);
      persistTurn("error", { errorCode: "unknown" });
      sink({
        type: "error",
        turnId,
        conversationId: conversationId || null,
        code: "unknown",
        message: `Unexpected error: ${(err as Error).message ?? String(err)}`,
      });
    } finally {
      this.active.delete(turnId);
    }
  }

  private ensureConversationId(req: ChatTurnRequest): string {
    if (!this.store) return EMPTY_CONVERSATION_ID;
    if (req.conversationId) return req.conversationId;
    const now = Date.now();
    const conv = this.store.createConversation({
      title: req.question,
      modelName: req.modelName,
      now,
    });
    return conv.id;
  }
}

function classifyError(err: unknown): ChatTurnErrorEvent["code"] {
  const msg = (err as Error)?.message ?? "";
  if (err instanceof TypeError || /fetch failed|ECONNREFUSED/i.test(msg)) {
    return "ollama_unreachable";
  }
  if (/HTTP 404|model.*not found/i.test(msg)) return "model_missing";
  if (/context|tokens?\b.*length/i.test(msg)) return "context_overflow";
  return "unknown";
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm -F @archi/chat test`
Expected: all chatService.persistence tests pass; original chatService tests still pass (they don't pass a `store`, so the new behavior is gated off).

If the original `chatService.test.ts` fails because its assertions check `done.citations` and that still works, but it also expects no `conversationId` field — that's fine: `done.conversationId` is now `""` and the existing tests don't read it. If any test fails, check what's new in the event shape and update the test only to ignore `conversationId` (don't change the production code).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @archi/chat typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/chatService.ts packages/chat/tests/chatService.persistence.test.ts
git commit -m "chat-history: ChatService persists turns when a ChatStore is injected"
```

---

## Task 9: Wire ChatStore into the desktop main process

**Files:**
- Modify: `apps/desktop/src/main/chatModule.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Update chatModule.ts**

Replace `apps/desktop/src/main/chatModule.ts` with:

```ts
import path from "node:path";
import {
  ChatService,
  ChatStore,
  OllamaClient,
  openChatDatabase,
  type ChatDatabase,
  type LLMClient,
} from "@archi/chat";
import type { SearchService } from "@archi/search";

export type ChatModule = {
  llm: LLMClient;
  service: ChatService;
  store: ChatStore;
  db: ChatDatabase;
};

export function createChatModule(opts: {
  search: SearchService;
  userDataPath: string;
}): ChatModule {
  const db = openChatDatabase(path.join(opts.userDataPath, "chat.sqlite"));
  const store = new ChatStore(db);
  const llm = new OllamaClient();
  const service = new ChatService({ search: opts.search, llm, store });
  return { llm, service, store, db };
}
```

- [ ] **Step 2: Pass userDataPath at the callsite**

In `apps/desktop/src/main/index.ts`, find the line:

```ts
  const chatModule = createChatModule({ search: searchModule.search });
```

Replace it with:

```ts
  const chatModule = createChatModule({ search: searchModule.search, userDataPath });
```

(`userDataPath` is already declared in scope at line ~205.)

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/chatModule.ts apps/desktop/src/main/index.ts
git commit -m "chat-history: open chat.sqlite under userData and inject into ChatService"
```

---

## Task 10: IPC handlers for list / load / rename / delete + historyChanged broadcast

**Files:**
- Modify: `apps/desktop/src/main/ipc/chatIpc.ts`

- [ ] **Step 1: Replace chatIpc.ts**

Replace `apps/desktop/src/main/ipc/chatIpc.ts` with:

```ts
import { ipcMain, BrowserWindow } from "electron";
import type {
  ChatConversation,
  ChatTurnRequest,
  LoadedConversation,
  ModelInfo,
  PullProgress,
} from "@archi/chat";
import type { ChatModule } from "../chatModule.js";

function broadcastHistoryChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("archi:chat:historyChanged");
    }
  }
}

export function registerChatIpc(module: ChatModule): void {
  ipcMain.handle("archi:chat:detect", async () => module.llm.detect());

  ipcMain.handle("archi:chat:listModels", async (): Promise<ModelInfo[]> =>
    module.llm.listModels()
  );

  ipcMain.handle("archi:chat:pullModel", async (event, name: string) => {
    const sender = event.sender;
    void (async () => {
      try {
        for await (const progress of module.llm.pullModel(name)) {
          if (sender.isDestroyed()) return;
          sender.send("archi:chat:pullProgress", progress satisfies PullProgress);
          if (progress.done || progress.error) return;
        }
      } catch (err) {
        if (sender.isDestroyed()) return;
        sender.send("archi:chat:pullProgress", {
          name,
          status: "error",
          done: true,
          error: (err as Error).message,
        });
      }
    })();
    return { started: true };
  });

  ipcMain.handle("archi:chat:turn", async (event, req: ChatTurnRequest) => {
    const sender = event.sender;
    module.service
      .runTurn(req, (e) => {
        if (sender.isDestroyed()) return;
        switch (e.type) {
          case "token":
            sender.send("archi:chat:token", { turnId: e.turnId, delta: e.delta });
            break;
          case "done":
            sender.send("archi:chat:done", {
              turnId: e.turnId,
              conversationId: e.conversationId,
              citations: e.citations,
              durationMs: e.durationMs,
              skipped: e.skipped,
              skipReason: e.skipReason,
            });
            broadcastHistoryChanged();
            break;
          case "error":
            sender.send("archi:chat:error", {
              turnId: e.turnId,
              conversationId: e.conversationId,
              code: e.code,
              message: e.message,
            });
            broadcastHistoryChanged();
            break;
          case "aborted":
            sender.send("archi:chat:aborted", {
              turnId: e.turnId,
              conversationId: e.conversationId,
            });
            broadcastHistoryChanged();
            break;
        }
      })
      .catch((err) => {
        console.error(`[chat ipc] runTurn rejected for turn ${req.turnId}:`, err);
        if (!sender.isDestroyed()) {
          sender.send("archi:chat:error", {
            turnId: req.turnId,
            conversationId: req.conversationId ?? null,
            code: "unknown",
            message: `Chat service crashed: ${(err as Error).message ?? String(err)}`,
          });
        }
      });
    return { accepted: true, turnId: req.turnId };
  });

  ipcMain.handle("archi:chat:cancel", async (_event, turnId: string) => {
    module.service.cancel(turnId);
  });

  ipcMain.handle("archi:chat:listConversations", async (): Promise<ChatConversation[]> => {
    return module.store.listConversations();
  });

  ipcMain.handle(
    "archi:chat:loadConversation",
    async (_event, id: string): Promise<LoadedConversation> => {
      return module.store.loadConversation(id);
    }
  );

  ipcMain.handle(
    "archi:chat:renameConversation",
    async (_event, id: string, title: string): Promise<void> => {
      module.store.renameConversation(id, title);
      broadcastHistoryChanged();
    }
  );

  ipcMain.handle(
    "archi:chat:deleteConversation",
    async (_event, id: string): Promise<void> => {
      module.store.deleteConversation(id);
      broadcastHistoryChanged();
    }
  );
}

export function chatBroadcast(window: BrowserWindow, channel: string, payload: unknown): void {
  if (!window.isDestroyed()) {
    window.webContents.send(channel, payload);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/ipc/chatIpc.ts
git commit -m "chat-history: IPC for list/load/rename/delete + historyChanged broadcast"
```

---

## Task 11: Expose history API in preload + env types

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/env.d.ts`

- [ ] **Step 1: Add types to the preload top**

Near the top of `apps/desktop/src/preload/index.ts`, in the existing `import type` block from `@archi/chat`, add `ChatConversation, LoadedConversation`:

```ts
import type {
  ChatConversation,
  ChatTurnRequest,
  ChatTurnDoneEvent,
  ChatTurnErrorEvent,
  ChatTurnTokenEvent,
  ChatTurnAbortedEvent,
  DetectResult,
  LoadedConversation,
  ModelInfo,
  PullProgress,
} from "@archi/chat";
```

- [ ] **Step 2: Extend the `chat` API block**

Inside the `api.chat` object literal, after the existing `onAborted` entry, add:

```ts
    listConversations: (): Promise<ChatConversation[]> =>
      ipcRenderer.invoke("archi:chat:listConversations"),
    loadConversation: (id: string): Promise<LoadedConversation> =>
      ipcRenderer.invoke("archi:chat:loadConversation", id),
    renameConversation: (id: string, title: string): Promise<void> =>
      ipcRenderer.invoke("archi:chat:renameConversation", id, title),
    deleteConversation: (id: string): Promise<void> =>
      ipcRenderer.invoke("archi:chat:deleteConversation", id),
    onHistoryChanged: (cb: () => void): (() => void) => {
      const handler = (): void => cb();
      ipcRenderer.on("archi:chat:historyChanged", handler);
      return () => ipcRenderer.removeListener("archi:chat:historyChanged", handler);
    },
```

- [ ] **Step 3: Update env.d.ts types**

In `apps/desktop/src/renderer/env.d.ts`, replace the `chat: { … }` block (around line 224) with this extended version. Keep all existing entries; only the last four lines + import additions are new.

First, add `ChatConversation` and `LoadedConversation` to the type imports near the top of the file (they're imported from `@archi/chat`).

Then replace the chat block with:

```ts
      chat: {
        detect: () => Promise<DetectResult>;
        listModels: () => Promise<ModelInfo[]>;
        pullModel: (name: string) => Promise<{ started: boolean }>;
        turn: (req: ChatTurnRequest) => Promise<{ accepted: boolean; turnId: string }>;
        cancel: (turnId: string) => Promise<void>;
        onPullProgress: (cb: (p: PullProgress) => void) => () => void;
        onToken: (cb: (e: ChatTurnTokenEvent) => void) => () => void;
        onDone: (cb: (e: ChatTurnDoneEvent) => void) => () => void;
        onError: (cb: (e: ChatTurnErrorEvent) => void) => () => void;
        onAborted: (cb: (e: ChatTurnAbortedEvent) => void) => () => void;
        listConversations: () => Promise<ChatConversation[]>;
        loadConversation: (id: string) => Promise<LoadedConversation>;
        renameConversation: (id: string, title: string) => Promise<void>;
        deleteConversation: (id: string) => Promise<void>;
        onHistoryChanged: (cb: () => void) => () => void;
      };
```

(If the file has no current import for `ChatConversation` and `LoadedConversation`, add them to the chat types import block at the top.)

- [ ] **Step 4: Typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/renderer/env.d.ts
git commit -m "chat-history: expose history API in preload + env types"
```

---

## Task 12: useChatHistory hook + useChatTurn carries conversationId

**Files:**
- Create: `apps/desktop/src/renderer/hooks/useChatHistory.ts`
- Modify: `apps/desktop/src/renderer/hooks/useChatTurn.ts`

- [ ] **Step 1: Create the history hook**

Create `apps/desktop/src/renderer/hooks/useChatHistory.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { ChatConversation } from "@archi/chat";

export type UseChatHistoryResult = {
  conversations: ChatConversation[];
  refresh: () => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export function useChatHistory(): UseChatHistoryResult {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);

  const refresh = useCallback(async () => {
    const list = await window.archi.chat.listConversations();
    setConversations(list);
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.archi.chat.onHistoryChanged(() => void refresh());
    return () => off();
  }, [refresh]);

  const rename = useCallback(
    async (id: string, title: string) => {
      await window.archi.chat.renameConversation(id, title);
      // historyChanged broadcast will refresh; no need to await.
    },
    []
  );

  const remove = useCallback(async (id: string) => {
    await window.archi.chat.deleteConversation(id);
  }, []);

  return { conversations, refresh, rename, remove };
}
```

- [ ] **Step 2: Update useChatTurn to track conversationId from events**

Replace `apps/desktop/src/renderer/hooks/useChatTurn.ts` with:

```ts
import { useEffect, useRef, useState, useCallback } from "react";
import type {
  ChatTurnDoneEvent,
  ChatTurnRequest,
} from "@archi/chat";

type TurnStatus = "streaming" | "done" | "aborted" | "error" | "skipped";

export type UseChatTurnResult = {
  turnId: string | null;
  conversationId: string | null;
  status: TurnStatus | null;
  text: string;
  citations: ChatTurnDoneEvent["citations"];
  errorMessage: string | null;
  skipReason: ChatTurnDoneEvent["skipReason"] | null;
  send: (req: Omit<ChatTurnRequest, "turnId">) => Promise<void>;
  cancel: () => void;
  reset: () => void;
};

function uuid(): string {
  return crypto.randomUUID();
}

export function useChatTurn(): UseChatTurnResult {
  const [turnId, setTurnId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [status, setStatus] = useState<TurnStatus | null>(null);
  const [text, setText] = useState("");
  const [citations, setCitations] = useState<ChatTurnDoneEvent["citations"]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState<ChatTurnDoneEvent["skipReason"] | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);

  useEffect(() => {
    const offToken = window.archi.chat.onToken((e) => {
      if (e.turnId !== activeTurnIdRef.current) return;
      setText((prev) => prev + e.delta);
    });
    const offDone = window.archi.chat.onDone((e) => {
      if (e.turnId !== activeTurnIdRef.current) return;
      setCitations(e.citations);
      setConversationId(e.conversationId);
      if (e.skipped) {
        setStatus("skipped");
        setSkipReason(e.skipReason ?? null);
      } else {
        setStatus("done");
      }
    });
    const offError = window.archi.chat.onError((e) => {
      if (e.turnId !== activeTurnIdRef.current) return;
      if (e.conversationId) setConversationId(e.conversationId);
      setStatus("error");
      setErrorMessage(e.message);
    });
    const offAborted = window.archi.chat.onAborted((e) => {
      if (e.turnId !== activeTurnIdRef.current) return;
      if (e.conversationId) setConversationId(e.conversationId);
      setStatus("aborted");
    });
    return () => {
      offToken();
      offDone();
      offError();
      offAborted();
    };
  }, []);

  const reset = useCallback(() => {
    activeTurnIdRef.current = null;
    setTurnId(null);
    setConversationId(null);
    setStatus(null);
    setText("");
    setCitations([]);
    setErrorMessage(null);
    setSkipReason(null);
  }, []);

  const send = useCallback(
    async (req: Omit<ChatTurnRequest, "turnId">) => {
      const id = uuid();
      activeTurnIdRef.current = id;
      setTurnId(id);
      setStatus("streaming");
      setText("");
      setCitations([]);
      setErrorMessage(null);
      setSkipReason(null);
      await window.archi.chat.turn({ ...req, turnId: id });
    },
    []
  );

  const cancel = useCallback(() => {
    const id = activeTurnIdRef.current;
    if (!id) return;
    void window.archi.chat.cancel(id);
  }, []);

  return {
    turnId,
    conversationId,
    status,
    text,
    citations,
    errorMessage,
    skipReason,
    send,
    cancel,
    reset,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/hooks/useChatHistory.ts apps/desktop/src/renderer/hooks/useChatTurn.ts
git commit -m "chat-history: renderer hooks for history list + conversationId tracking"
```

---

## Task 13: ChatHistoryItem (row with rename + kebab)

**Files:**
- Create: `apps/desktop/src/renderer/components/chat/ChatHistoryItem.tsx`

- [ ] **Step 1: Create the component**

Create `apps/desktop/src/renderer/components/chat/ChatHistoryItem.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ChatConversation } from "@archi/chat";

export type ChatHistoryItemProps = {
  conversation: ChatConversation;
  active: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onRequestDelete: (id: string) => void;
};

export function ChatHistoryItem(props: ChatHistoryItemProps): JSX.Element {
  const { conversation, active, onSelect, onRename, onRequestDelete } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const commitRename = async (): Promise<void> => {
    const next = draft.trim();
    if (next && next !== conversation.title) {
      await onRename(conversation.id, next);
    } else {
      setDraft(conversation.title);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="chat-history-item chat-history-item--editing">
        <input
          ref={inputRef}
          className="ui-input ui-input--sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitRename();
            } else if (e.key === "Escape") {
              setDraft(conversation.title);
              setEditing(false);
            }
          }}
          maxLength={60}
        />
      </div>
    );
  }

  return (
    <div
      className={`chat-history-item${active ? " chat-history-item--active" : ""}`}
    >
      <button
        type="button"
        className="chat-history-item-title"
        onClick={() => onSelect(conversation.id)}
        title={conversation.title}
      >
        {conversation.title}
      </button>
      <div className="chat-history-item-menu">
        <button
          type="button"
          className="ui-btn ui-btn--ghost ui-btn--sm chat-history-item-kebab"
          aria-label="More"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="chat-history-item-popup" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="ui-btn ui-btn--ghost ui-btn--sm"
              onClick={() => {
                setMenuOpen(false);
                setDraft(conversation.title);
                setEditing(true);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--ghost ui-btn--sm chat-history-item-popup-danger"
              onClick={() => {
                setMenuOpen(false);
                onRequestDelete(conversation.id);
              }}
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/chat/ChatHistoryItem.tsx
git commit -m "chat-history: ChatHistoryItem with inline rename + kebab menu"
```

---

## Task 14: ChatHistoryDeleteModal

**Files:**
- Create: `apps/desktop/src/renderer/components/chat/ChatHistoryDeleteModal.tsx`

- [ ] **Step 1: Create the component**

Create `apps/desktop/src/renderer/components/chat/ChatHistoryDeleteModal.tsx`:

```tsx
export type ChatHistoryDeleteModalProps = {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ChatHistoryDeleteModal(props: ChatHistoryDeleteModalProps): JSX.Element {
  const { title, onCancel, onConfirm } = props;
  return (
    <div className="ui-modal-backdrop" onClick={onCancel}>
      <div
        className="ui-card ui-modal-card chat-history-delete-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="ui-card__title">Delete this conversation?</h2>
        <p className="chat-history-delete-modal-body">
          “{title}” will be permanently removed. This can't be undone.
        </p>
        <div className="chat-history-delete-modal-actions">
          <button type="button" className="ui-btn ui-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ui-btn ui-btn--danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/chat/ChatHistoryDeleteModal.tsx
git commit -m "chat-history: delete-confirm modal"
```

---

## Task 15: ChatHistoryRail (grouping, collapse, empty state)

Groups conversations into `Today` / `Yesterday` / `Earlier` by `updatedAt`. The collapse toggle stores its state in a renderer preference so it survives reloads.

**Files:**
- Create: `apps/desktop/src/renderer/components/chat/ChatHistoryRail.tsx`

- [ ] **Step 1: Create the component**

Create `apps/desktop/src/renderer/components/chat/ChatHistoryRail.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { ChatConversation } from "@archi/chat";
import { ChatHistoryItem } from "./ChatHistoryItem.js";
import { ChatHistoryDeleteModal } from "./ChatHistoryDeleteModal.js";

export type ChatHistoryRailProps = {
  conversations: ChatConversation[];
  activeId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

type Bucket = { label: string; rows: ChatConversation[] };

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketize(conversations: ChatConversation[]): Bucket[] {
  const now = Date.now();
  const today = startOfDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;
  const buckets: Bucket[] = [
    { label: "Today", rows: [] },
    { label: "Yesterday", rows: [] },
    { label: "Earlier", rows: [] },
  ];
  for (const c of conversations) {
    if (c.updatedAt >= today) buckets[0]!.rows.push(c);
    else if (c.updatedAt >= yesterday) buckets[1]!.rows.push(c);
    else buckets[2]!.rows.push(c);
  }
  return buckets.filter((b) => b.rows.length > 0);
}

export function ChatHistoryRail(props: ChatHistoryRailProps): JSX.Element {
  const {
    conversations,
    activeId,
    collapsed,
    onToggleCollapsed,
    onSelect,
    onNewChat,
    onRename,
    onDelete,
  } = props;
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const buckets = useMemo(() => bucketize(conversations), [conversations]);
  const pendingDelete = useMemo(
    () => conversations.find((c) => c.id === pendingDeleteId) ?? null,
    [pendingDeleteId, conversations]
  );

  if (collapsed) {
    return (
      <aside className="chat-history-rail chat-history-rail--collapsed" aria-label="Chat history">
        <button
          type="button"
          className="ui-btn ui-btn--ghost chat-history-rail-new chat-history-rail-new--icon"
          onClick={onNewChat}
          aria-label="New chat"
          title="New chat"
        >
          +
        </button>
        <div className="chat-history-rail-dots" aria-hidden="true">
          {conversations.slice(0, 24).map((c) => (
            <span
              key={c.id}
              className={`chat-history-rail-dot${
                c.id === activeId ? " chat-history-rail-dot--active" : ""
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          className="ui-btn ui-btn--ghost chat-history-rail-toggle"
          onClick={onToggleCollapsed}
          aria-label="Expand history"
          title="Expand history"
        >
          »
        </button>
      </aside>
    );
  }

  return (
    <aside className="chat-history-rail" aria-label="Chat history">
      <button
        type="button"
        className="ui-btn ui-btn--secondary chat-history-rail-new"
        onClick={onNewChat}
      >
        + New chat
      </button>
      <div className="chat-history-rail-list">
        {buckets.length === 0 ? (
          <div className="chat-history-rail-empty">
            <span className="ui-fleuron" aria-hidden="true" />
            <p>Your conversations will appear here.</p>
          </div>
        ) : (
          buckets.map((b) => (
            <section key={b.label} className="chat-history-rail-group">
              <div className="ui-card__eyebrow chat-history-rail-group-label">{b.label}</div>
              {b.rows.map((c) => (
                <ChatHistoryItem
                  key={c.id}
                  conversation={c}
                  active={c.id === activeId}
                  onSelect={onSelect}
                  onRename={onRename}
                  onRequestDelete={(id) => setPendingDeleteId(id)}
                />
              ))}
            </section>
          ))
        )}
      </div>
      <button
        type="button"
        className="ui-btn ui-btn--ghost chat-history-rail-toggle"
        onClick={onToggleCollapsed}
        aria-label="Collapse history"
        title="Collapse history"
      >
        «
      </button>
      {pendingDelete ? (
        <ChatHistoryDeleteModal
          title={pendingDelete.title}
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => {
            const id = pendingDelete.id;
            setPendingDeleteId(null);
            void onDelete(id);
          }}
        />
      ) : null}
    </aside>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/chat/ChatHistoryRail.tsx
git commit -m "chat-history: ChatHistoryRail with bucketed grouping + collapse"
```

---

## Task 16: ChatHistoryRail styles

**Files:**
- Create: `apps/desktop/src/renderer/styles/chat-history.css`
- Modify: `apps/desktop/src/renderer/main.tsx`

- [ ] **Step 1: Write the CSS**

Create `apps/desktop/src/renderer/styles/chat-history.css`:

```css
.chat-screen-with-rail {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 0;
  height: 100%;
  min-height: 0;
}

.chat-screen-with-rail--collapsed {
  grid-template-columns: 48px 1fr;
}

.chat-history-rail {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--ink-100);
  background: color-mix(in srgb, var(--paper-base) 92%, transparent);
  min-height: 0;
  padding: 12px 8px;
}

.chat-history-rail--collapsed {
  align-items: center;
  padding: 12px 4px;
  gap: 12px;
}

.chat-history-rail-new {
  width: 100%;
  justify-content: center;
  margin-bottom: 12px;
}

.chat-history-rail-new--icon {
  width: 32px;
  height: 32px;
  margin-bottom: 0;
  padding: 0;
}

.chat-history-rail-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-history-rail-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat-history-rail-group-label {
  padding: 0 4px;
  margin-bottom: 4px;
}

.chat-history-rail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 12px;
  text-align: center;
  color: var(--ink-500);
  font-size: 13px;
}

.chat-history-item {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: 0;
  border-left: 2px solid transparent;
  padding: 4px 6px 4px 8px;
  gap: 4px;
}

.chat-history-item:hover {
  background: color-mix(in srgb, var(--accent-soft) 35%, transparent);
}

.chat-history-item--active {
  background: var(--accent-soft);
  border-left-color: var(--rule-warm-strong);
}

.chat-history-item--active .chat-history-item-title {
  font-weight: 600;
}

.chat-history-item-title {
  flex: 1;
  background: none;
  border: none;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  padding: 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-history-item-menu {
  position: relative;
  opacity: 0;
  transition: opacity 120ms;
}

.chat-history-item:hover .chat-history-item-menu,
.chat-history-item--active .chat-history-item-menu {
  opacity: 1;
}

.chat-history-item-kebab {
  padding: 0 6px;
  line-height: 1;
}

.chat-history-item-popup {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-width: 120px;
  border: 1px solid var(--ink-300);
  background: var(--paper-base);
  box-shadow: 0 6px 24px color-mix(in srgb, var(--ink-700) 12%, transparent);
}

.chat-history-item-popup button {
  justify-content: flex-start;
  border-radius: 0;
}

.chat-history-item-popup-danger {
  color: var(--accent-danger, #a23a26);
}

.chat-history-item--editing .ui-input {
  width: 100%;
}

.chat-history-rail-toggle {
  align-self: flex-end;
  margin-top: 8px;
  padding: 2px 6px;
}

.chat-history-rail--collapsed .chat-history-rail-toggle {
  align-self: center;
}

.chat-history-rail-dots {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
  overflow: hidden;
}

.chat-history-rail-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ink-500) 35%, transparent);
}

.chat-history-rail-dot--active {
  background: var(--rule-warm-strong);
}

.chat-history-delete-modal {
  max-width: 420px;
}

.chat-history-delete-modal-body {
  margin: 12px 0 20px;
  color: var(--ink-700);
}

.chat-history-delete-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 2: Import the stylesheet**

In `apps/desktop/src/renderer/main.tsx`, find the existing CSS imports and add:

```ts
import "./styles/chat-history.css";
```

after the existing `import "./styles/design-system.css";` line.

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: no errors. (CSS isn't typechecked but the import path must be valid.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/styles/chat-history.css apps/desktop/src/renderer/main.tsx
git commit -m "chat-history: styles for history rail + delete modal"
```

---

## Task 17: Wire rail + resume + new-chat into ChatScreen

**Files:**
- Modify: `apps/desktop/src/renderer/screens/ChatScreen.tsx`

- [ ] **Step 1: Replace ChatScreen.tsx**

Replace `apps/desktop/src/renderer/screens/ChatScreen.tsx` with:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ChatMessage } from "@archi/chat";
import type { SearchResult } from "@archi/search";
import { ChatMessageBubble } from "../components/chat/ChatMessageBubble.js";
import { ChatCitationList } from "../components/chat/ChatCitationList.js";
import { ChatStatusBadge } from "../components/chat/ChatStatusBadge.js";
import { ChatHistoryRail } from "../components/chat/ChatHistoryRail.js";
import { ChatSetupScreen } from "./ChatSetupScreen.js";
import { useChatTurn } from "../hooks/useChatTurn.js";
import { useChatHistory } from "../hooks/useChatHistory.js";

const PREF_MODEL = "chat.modelName";
const PREF_RAIL_COLLAPSED = "chat.historyRailCollapsed";

type RenderedMessage =
  | { kind: "user"; content: string }
  | {
      kind: "assistant";
      content: string;
      status: "streaming" | "done" | "aborted" | "error" | "skipped";
      citations: SearchResult[];
      errorMessage?: string | null;
      skipReason?: "no_passages" | null;
    };

export type ChatScreenProps = {
  onOpenWork: (workId: string, passageId: string) => void;
};

function jumpToCitation(messageId: string, n: number): void {
  const el = document.getElementById(`citation-${messageId}-${n}`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("ui-footnote-flash");
  void el.offsetWidth;
  el.classList.add("ui-footnote-flash");
  window.setTimeout(() => el.classList.remove("ui-footnote-flash"), 1600);
}

function renderWithCitations(text: string, messageId: string, maxN: number): ReactNode {
  if (!text || maxN === 0) return text;
  const parts: ReactNode[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[1];
    if (raw === undefined) continue;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 1 || n > maxN) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <button
        key={`${messageId}-ref-${match.index}-${n}`}
        type="button"
        className="ui-footnote-ref"
        onClick={() => jumpToCitation(messageId, n)}
        aria-label={`Jump to source ${n}`}
      >
        {n}
      </button>
    );
    last = match.index + match[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function ChatScreen({ onOpenWork }: ChatScreenProps): JSX.Element {
  const [modelName, setModelName] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [transcript, setTranscript] = useState<RenderedMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const turn = useChatTurn();
  const history = useChatHistory();
  const conversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      const stored = await window.archi.preferences.get<string | null>(PREF_MODEL, null);
      const railPref = await window.archi.preferences.get<boolean>(PREF_RAIL_COLLAPSED, false);
      setRailCollapsed(railPref);
      const detect = await window.archi.chat.detect();
      if (detect.status !== "ready" || !stored) {
        setNeedsSetup(true);
        return;
      }
      setModelName(stored);
      setNeedsSetup(false);
    })();
  }, []);

  // Keep the ref in sync with the turn-hook's reported conversationId so the
  // first turn's id propagates to follow-ups.
  useEffect(() => {
    if (turn.conversationId && turn.conversationId !== conversationIdRef.current) {
      conversationIdRef.current = turn.conversationId;
      setActiveConversationId(turn.conversationId);
    }
  }, [turn.conversationId]);

  useEffect(() => {
    if (turn.turnId === null) return;
    setTranscript((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.kind === "assistant") {
        next[next.length - 1] = {
          ...last,
          content: turn.text,
          status: turn.status ?? "streaming",
          citations: turn.citations as SearchResult[],
          errorMessage: turn.errorMessage,
          skipReason: turn.skipReason ?? null,
        };
      }
      return next;
    });
  }, [turn.text, turn.status, turn.citations, turn.errorMessage, turn.skipReason, turn.turnId]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const handleConfigured = useCallback(async (name: string) => {
    await window.archi.preferences.set(PREF_MODEL, name);
    setModelName(name);
    setNeedsSetup(false);
  }, []);

  const handleSend = useCallback(async () => {
    const question = draft.trim();
    if (!question || !modelName) return;
    setDraft("");
    const history: ChatMessage[] = transcript.flatMap<ChatMessage>((m) =>
      m.kind === "user"
        ? [{ role: "user", content: m.content }]
        : m.status === "done"
          ? [{ role: "assistant", content: m.content }]
          : []
    );
    setTranscript((prev) => [
      ...prev,
      { kind: "user", content: question },
      {
        kind: "assistant",
        content: "",
        status: "streaming",
        citations: [],
        errorMessage: null,
        skipReason: null,
      },
    ]);
    await turn.send({
      question,
      history,
      modelName,
      conversationId: conversationIdRef.current ?? undefined,
    });
  }, [draft, modelName, transcript, turn]);

  const handleNewChat = useCallback(() => {
    turn.reset();
    conversationIdRef.current = null;
    setActiveConversationId(null);
    setTranscript([]);
    setDraft("");
  }, [turn]);

  const handleSelectConversation = useCallback(
    async (id: string) => {
      turn.cancel();
      turn.reset();
      const loaded = await window.archi.chat.loadConversation(id);
      conversationIdRef.current = id;
      setActiveConversationId(id);
      setModelName(loaded.conversation.modelName);
      // Re-hydrate transcript. Citations are stored as passage-id arrays;
      // we keep them empty here and let the user re-search if they want
      // fresh hydration. (A future task can re-resolve them via the search index.)
      const rebuilt: RenderedMessage[] = [];
      for (const m of loaded.messages) {
        if (m.role === "user") {
          rebuilt.push({ kind: "user", content: m.content });
        } else {
          rebuilt.push({
            kind: "assistant",
            content: m.content,
            status: m.status === "done" ? "done" : m.status,
            citations: [],
            errorMessage: m.status === "error" ? m.errorCode : null,
            skipReason: m.status === "skipped" ? "no_passages" : null,
          });
        }
      }
      setTranscript(rebuilt);
    },
    [turn]
  );

  const handleToggleRail = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev;
      void window.archi.preferences.set(PREF_RAIL_COLLAPSED, next);
      return next;
    });
  }, []);

  if (needsSetup === null) {
    return (
      <div className="chat-screen chat-screen-loading">
        <span className="chat-spinner" aria-hidden="true" />
        <span>Loading chat…</span>
      </div>
    );
  }
  if (needsSetup) {
    return <ChatSetupScreen onConfigured={(name) => void handleConfigured(name)} />;
  }

  const sending = turn.status === "streaming";

  return (
    <div
      className={`chat-screen-with-rail${
        railCollapsed ? " chat-screen-with-rail--collapsed" : ""
      }`}
    >
      <ChatHistoryRail
        conversations={history.conversations}
        activeId={activeConversationId}
        collapsed={railCollapsed}
        onToggleCollapsed={handleToggleRail}
        onSelect={(id) => void handleSelectConversation(id)}
        onNewChat={handleNewChat}
        onRename={history.rename}
        onDelete={history.remove}
      />
      <div className="chat-screen">
        <header className="chat-screen-header">
          <ChatStatusBadge modelName={modelName} />
          <button
            type="button"
            className="ui-btn ui-btn--secondary ui-btn--sm"
            onClick={handleNewChat}
          >
            New chat
          </button>
        </header>
        <div className="chat-transcript" role="log" aria-live="polite" ref={transcriptRef}>
          {transcript.map((m, i) => {
            if (m.kind === "user") {
              return <ChatMessageBubble key={i} role="user" text={m.content} />;
            }
            if (m.status === "skipped") {
              return (
                <ChatMessageBubble
                  key={i}
                  role="assistant"
                  text="No passages in your library matched that. Try a broader question."
                />
              );
            }
            if (m.status === "error") {
              return (
                <ChatMessageBubble
                  key={i}
                  role="assistant"
                  text={m.errorMessage ?? "Something went wrong."}
                />
              );
            }
            if (m.status === "streaming" && !m.content) {
              return (
                <div key={i} className="chat-bubble chat-bubble-assistant chat-bubble-thinking">
                  <span className="chat-typing" aria-label="Thinking">
                    <span className="chat-typing-dot" />
                    <span className="chat-typing-dot" />
                    <span className="chat-typing-dot" />
                  </span>
                  <span className="chat-typing-caption">Thinking…</span>
                </div>
              );
            }
            const messageId = `m${i}`;
            const hasCitations =
              (m.status === "done" || m.status === "aborted") && m.citations.length > 0;
            const richText = renderWithCitations(m.content, messageId, m.citations.length);
            return (
              <div key={i} className="chat-message-block">
                <ChatMessageBubble
                  role="assistant"
                  text={richText}
                  ghosted={m.status === "aborted"}
                  footer={
                    m.status === "streaming" ? (
                      <span className="chat-typing chat-typing-inline" aria-hidden="true">
                        <span className="chat-typing-dot" />
                        <span className="chat-typing-dot" />
                        <span className="chat-typing-dot" />
                      </span>
                    ) : null
                  }
                />
                {hasCitations ? (
                  <ChatCitationList
                    citations={m.citations}
                    messageId={messageId}
                    onOpenWork={onOpenWork}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <textarea
            className="ui-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask something about your library…"
            disabled={sending}
            rows={3}
          />
          <div className="chat-composer-actions">
            {sending ? (
              <button
                type="button"
                className="ui-btn ui-btn--secondary"
                onClick={turn.cancel}
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                className="ui-btn ui-btn--primary"
                disabled={!draft.trim()}
              >
                Send
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Drop the "not saved" hint**

The previous `<div className="chat-screen-empty-hint">` line was removed in the replacement — verify no orphaned CSS rule remains by grepping:

Run: `grep -n "chat-screen-empty-hint" apps/desktop/src/renderer/styles.css`
If found, leave it for now (Task 19 cleanup), don't fix here.

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/screens/ChatScreen.tsx
git commit -m "chat-history: wire rail + resume + new-chat into ChatScreen"
```

---

## Task 18: Manual-QA checklist + dev-server smoke verification

**Files:**
- Create: `docs/qa/chat-history.md`

- [ ] **Step 1: Write the checklist**

Create `docs/qa/chat-history.md`:

```markdown
# Chat History QA

Run `pnpm dev` from repo root, then through each path below.

## Persist + resume
- [ ] Open Chat. Send "What is wisdom?". Verify a conversation row appears in the rail with the title "What is wisdom?".
- [ ] Send a follow-up turn in the same conversation. Verify the rail row stays a single entry and moves to top.
- [ ] Click `+ New chat`. Verify the transcript clears and the rail row is no longer marked active.
- [ ] Submit a turn in the fresh chat. Verify a new rail row appears.
- [ ] Quit the app. Re-launch. Verify both conversations are still in the rail and ordered newest-first.

## Resume into existing conversation
- [ ] Click a past conversation. Verify the transcript hydrates with the user + assistant messages.
- [ ] Send a follow-up. Verify it joins the same conversation (no new row appears).

## Rename
- [ ] Hover a conversation; click the kebab → Rename. Edit the title; press Enter. Verify the title updates without page reload.
- [ ] Repeat with Escape. Verify nothing changes.

## Delete
- [ ] Hover a conversation; click the kebab → Delete. Confirm. Verify the row disappears.
- [ ] Quit and relaunch. Verify it's still gone.

## Collapse rail
- [ ] Click the « toggle at the rail bottom. Verify the rail collapses to icons + dots.
- [ ] Click an active dot. Verify it expands back (or the rail toggle re-expands it).
- [ ] Reload renderer (Cmd-R). Verify the rail preserves its collapsed state.

## Edge cases
- [ ] Submit a question with no matching passages. Verify the conversation is created with status `skipped` for the assistant message, and the rail shows the row.
- [ ] Stop Ollama (or use a bogus model name) and submit a turn. Verify the conversation is created and the assistant message persists with status `error`.
- [ ] Abort an in-flight turn mid-stream. Verify the partial response is persisted with status `aborted`.

## Empty state
- [ ] On a fresh install (delete `~/Library/Application Support/Archi/chat.sqlite`, then relaunch), verify the rail shows "Your conversations will appear here." with a fleuron.
```

- [ ] **Step 2: Verify the dev server can compile the full app**

Run: `pnpm -F @archi/chat build`
Expected: dist/ rebuilt with no errors.

Run: `pnpm -F @archi/desktop typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add docs/qa/chat-history.md
git commit -m "chat-history: manual QA checklist"
```

---

## Task 19: Cleanup — remove the obsolete "not saved" hint CSS

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Find the rule**

Run: `grep -n "chat-screen-empty-hint" apps/desktop/src/renderer/styles.css`

- [ ] **Step 2: Remove the rule**

Open `apps/desktop/src/renderer/styles.css` and delete the `.chat-screen-empty-hint { … }` block (typically a few lines styling a small italic line under the chat header).

If the rule has already been removed during prior cleanup, this task is a no-op — verify with `grep` and skip to commit.

- [ ] **Step 3: Typecheck (sanity)**

Run: `pnpm -F @archi/desktop typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

If anything changed:

```bash
git add apps/desktop/src/renderer/styles.css
git commit -m "chat-history: drop the 'not saved' hint CSS (now persisted)"
```

If nothing changed, skip.

---

## Self-Review (controller's checklist, run after writing the plan — already complete)

1. **Spec coverage:**
   - §3 schema → Task 2.
   - §4 persistence flow (create on first submit, transactional pair, status on all terminal states) → Tasks 4 + 8.
   - §5 resume flow (loadConversation, conversationId thread) → Tasks 10 + 12 + 17.
   - §6 IPC channels → Task 10.
   - §7 file organization → Tasks 2-7, 12-15.
   - §8 UI (two-pane, group headers, kebab, modal, collapse) → Tasks 13-17.
   - §9 state & lifecycle → Task 17.
   - §10 error handling (persistence_failed, load failure UX) → Tasks 7 + 8; load failure is surfaced by promise rejection naturally and renders no transcript; QA checklist covers it.
   - §11 privacy: covered by `chat.sqlite` under `userData` only — no extra code needed.
   - §12 testing → Tasks 3-6, 8, 18.
   - §13 risks: rebuild verified in Task 1; concurrent writes are SQLite-handled.
2. **Placeholder scan:** none.
3. **Type consistency:** `ChatStore`, `ChatConversation`, `ChatStoredMessage`, `LoadedConversation`, `AppendTurnInput` are introduced in Tasks 3-5 and re-used identically in Tasks 7-15.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-chat-history.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review after each, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
