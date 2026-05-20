import fs from "node:fs";
import path from "node:path";

type Record_ = Record<string, unknown>;

export class PreferencesStore {
  private readonly filePath: string;

  constructor(baseDirectory: string) {
    this.filePath = path.join(baseDirectory, "prefs.json");
  }

  get<T>(key: string, fallback: T): T {
    const records = this.readAll();
    if (!(key in records)) {
      return fallback;
    }
    return records[key] as T;
  }

  set(key: string, value: unknown): void {
    const records = this.readAll();
    records[key] = value;
    this.writeAll(records);
  }

  private readAll(): Record_ {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    try {
      const content = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(content) as Record_;
    } catch {
      return {};
    }
  }

  private writeAll(records: Record_): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(records, null, 2), "utf8");
  }
}
