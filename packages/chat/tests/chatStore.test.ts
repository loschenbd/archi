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
