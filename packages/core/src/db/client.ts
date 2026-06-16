import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { MIGRATIONS } from "./migrations.js";

export type CoreDatabase = Database.Database;

export function openCoreDatabase(path: string): CoreDatabase {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  loadSqliteVec(db);
  applyMigrations(db);
  return db;
}

// sqlite-vec's getLoadablePath() resolves the platform-specific vec0.dylib via
// Node's package-exports machinery, which in a packaged Electron app returns a
// path inside `app.asar`. Electron transparently rewrites fs reads to
// app.asar.unpacked, but dlopen() is a system call that doesn't go through
// Electron's fs — SQLite calls dlopen on the literal asar path and gets
// ENOTDIR. Rewrite the path here so dlopen sees the real on-disk file. No-op
// in dev (no asar in the path).
function loadSqliteVec(db: Database.Database): void {
  const loadablePath = sqliteVec.getLoadablePath().replace("/app.asar/", "/app.asar.unpacked/");
  db.loadExtension(loadablePath);
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
