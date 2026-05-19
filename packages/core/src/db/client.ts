import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations.js";

export type CoreDatabase = Database.Database;

export function openCoreDatabase(path: string): CoreDatabase {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

function applyMigrations(db: CoreDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const existingRows = db.prepare("SELECT version FROM migrations").all() as Array<{ version: number }>;
  const existing = new Set(existingRows.map((row) => row.version));

  const transaction = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (existing.has(migration.version)) {
        continue;
      }
      db.exec(migration.sql);
      db.prepare("INSERT INTO migrations(version, applied_at) VALUES (?, ?)").run(migration.version, new Date().toISOString());
    }
  });

  transaction();
}
