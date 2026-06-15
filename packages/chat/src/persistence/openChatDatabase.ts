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
