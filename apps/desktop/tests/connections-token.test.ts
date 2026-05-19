import { describe, expect, it } from "vitest";
import {
  CloudNotebookConnectionAdapter,
  NotionConnectionAdapter,
  type AppSettingsAccess,
  type NotionAuth,
  type NotionAuthStore
} from "../src/main/connections.js";

const settings: AppSettingsAccess = {
  getDeviceExportPath: () => "/tmp/My Clippings.txt",
  getCloudSettings: () => ({
    enabled: false,
    notebookUrl: "https://read.amazon.com/notebook",
    storageStatePath: "/tmp/cloud-state.json"
  }),
  getNotionSettings: () => ({
    parentPageId: "parent"
  })
};

class TestNotionAdapter extends NotionConnectionAdapter {
  async testConnection() {
    return this.getStatus();
  }
}

function createAuthStore(): { store: NotionAuthStore; getRaw: () => NotionAuth | null } {
  let auth: NotionAuth | null = null;
  return {
    store: {
      get: () => auth,
      set: (next) => {
        auth = next;
      },
      clear: () => {
        auth = null;
      }
    },
    getRaw: () => auth
  };
}

describe("Notion token connect flow", () => {
  it("returns needs_action before token is set", async () => {
    const auth = createAuthStore();
    const adapter = new TestNotionAdapter(settings, auth.store);
    const status = await adapter.getStatus();
    expect(status.status).toBe("needs_action");
    expect(status.hints.some((hint) => hint.includes("integration token"))).toBe(true);
  });

  it("stores token and becomes connected via token flow", async () => {
    const auth = createAuthStore();
    const adapter = new TestNotionAdapter(settings, auth.store);
    const status = await adapter.connectWithToken("secret_test_123");
    expect(status.status).toBe("connected");
    expect(auth.getRaw()?.accessToken).toBe("secret_test_123");
  });
});

describe("Cloud reconnect diagnostics", () => {
  it("reports disconnected when cloud sync is disabled", async () => {
    const adapter = new CloudNotebookConnectionAdapter(
      settings,
      {
        getStatus: async () => "needs_auth",
        reconnect: async () => undefined,
        fetchSince: async () => ({ passages: [] })
      } as never
    );

    const status = await adapter.getStatus();
    expect(status.status).toBe("disconnected");
    expect(status.diagnostics?.summary).toContain("disabled");
  });
});

