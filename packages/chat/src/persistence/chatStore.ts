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
