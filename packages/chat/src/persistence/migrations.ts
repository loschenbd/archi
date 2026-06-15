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
