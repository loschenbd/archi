import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";

type StoredCredentialRecord = Record<string, string>;
type CredentialStoreOptions = {
  allowEncryption: boolean;
};

export class CredentialStore {
  private readonly filePath: string;
  private readonly options: CredentialStoreOptions;

  constructor(baseDirectory: string, options?: Partial<CredentialStoreOptions>) {
    this.filePath = path.join(baseDirectory, "credentials.json");
    this.options = {
      allowEncryption: options?.allowEncryption ?? true
    };
  }

  get(key: string): string | null {
    const records = this.readAll();
    const raw = records[key];
    if (!raw) {
      return null;
    }
    const decoded = this.decode(raw);
    if (decoded === null) {
      return null;
    }
    if (!this.options.allowEncryption && raw.startsWith("enc:")) {
      records[key] = `plain:${decoded}`;
      this.writeAll(records);
    }
    return decoded;
  }

  set(key: string, value: string): void {
    const records = this.readAll();
    records[key] = this.encode(value);
    this.writeAll(records);
  }

  delete(key: string): void {
    const records = this.readAll();
    delete records[key];
    this.writeAll(records);
  }

  private readAll(): StoredCredentialRecord {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    try {
      const content = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(content) as StoredCredentialRecord;
      return parsed;
    } catch {
      return {};
    }
  }

  private writeAll(records: StoredCredentialRecord): void {
    fs.writeFileSync(this.filePath, JSON.stringify(records, null, 2));
  }

  private encode(value: string): string {
    if (!this.options.allowEncryption || !safeStorage.isEncryptionAvailable()) {
      return `plain:${value}`;
    }
    return `enc:${safeStorage.encryptString(value).toString("base64")}`;
  }

  private decode(value: string): string | null {
    if (value.startsWith("plain:")) {
      return value.slice("plain:".length);
    }
    if (!value.startsWith("enc:")) {
      return null;
    }
    const base64 = value.slice("enc:".length);
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(base64, "base64"));
      return decrypted;
    } catch {
      return null;
    }
  }
}

