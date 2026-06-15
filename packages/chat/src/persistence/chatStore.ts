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
        .run(input.now, input.conversationId);
    });
    tx();
  }
}
