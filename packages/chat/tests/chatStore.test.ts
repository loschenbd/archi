import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
