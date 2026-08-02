import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeNotionError, createFakeNotionClient, type FakeClientHandle } from "./helpers/fakeNotionClient.js";

let handle: FakeClientHandle;

vi.mock("@notionhq/client", () => ({
  Client: class {
    constructor(options: Record<string, unknown>) {
      return new handle.ClientMock(options) as object;
    }
  }
}));

const { NotionDestination } = await import("../src/index.js");

const CONFIG = {
  integrationToken: "secret_test",
  parentPageId: "page_parent",
  libraryDatabaseId: "db_library",
  passagesDatabaseId: "db_passages",
  // Pacing is covered by rate-limiter.test.ts; keep these suites fast.
  rateLimit: { requestsPerSecond: 1_000_000, sleep: async () => undefined }
};

const WORK = {
  sourceWorkId: "work_1",
  displayTitle: "Thinking, Fast and Slow",
  workType: "book",
  ingestSource: "device_export",
  labels: [],
  isArchived: false
} as never;

const PASSAGE = {
  workId: "work_1",
  externalPassageId: "ext_p1",
  body: "Nothing in life is as important as you think it is while you are thinking about it.",
  labels: [],
  isStarred: false,
  isHidden: false,
  isArchived: false,
  fingerprintHash: "fp_abc123"
} as never;

describe("2025-09-03 data-source migration", () => {
  beforeEach(() => {
    handle = createFakeNotionClient();
  });

  it("pins an explicit Notion-Version on EVERY constructed client", async () => {
    const destination = new NotionDestination({ ...CONFIG });
    await destination.syncBatch([WORK], [PASSAGE]);

    expect(handle.constructorOptions.length).toBeGreaterThan(0);
    for (const options of handle.constructorOptions) {
      // Relying on Client.defaultNotionVersion is the defect this guards:
      // an omitted pin silently tracks whatever the installed SDK ships.
      expect(options.notionVersion, `client constructed without an explicit notionVersion: ${JSON.stringify(options)}`).toBeTruthy();
      expect(String(options.notionVersion)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("pins the main client to a post-split API version", async () => {
    const destination = new NotionDestination({ ...CONFIG });
    await destination.syncBatch([WORK], []);

    const versions = handle.constructorOptions.map((options) => String(options.notionVersion));
    for (const version of versions) {
      expect(version >= "2025-09-03").toBe(true);
    }
  });

  it("queries data sources, never the legacy database query endpoint", async () => {
    const destination = new NotionDestination({ ...CONFIG });
    await destination.syncBatch([WORK], [PASSAGE]);

    expect(handle.callsTo("databases.query")).toHaveLength(0);
    expect(handle.callsTo("dataSources.query").length).toBeGreaterThan(0);
    for (const call of handle.callsTo("dataSources.query")) {
      expect(call.args.data_source_id).toBeTruthy();
    }
  });

  it("creates pages with a data_source_id parent, never a database_id parent", async () => {
    const destination = new NotionDestination({ ...CONFIG });
    await destination.syncBatch([WORK], [PASSAGE]);

    const creates = handle.callsTo("pages.create");
    expect(creates.length).toBeGreaterThan(0);
    for (const call of creates) {
      const parent = call.args.parent as Record<string, unknown>;
      // Workspace-parented root page creation is exempt.
      if (parent.workspace === true || parent.type === "workspace") {
        continue;
      }
      expect(parent.database_id, `page created with a database_id parent: ${JSON.stringify(parent)}`).toBeUndefined();
      expect(parent.data_source_id).toBeTruthy();
    }
  });

  it("reads and writes schema through the data source, not the database container", async () => {
    handle = createFakeNotionClient({ databaseProperties: {} });
    const destination = new NotionDestination({ ...CONFIG });
    await destination.syncBatch([WORK], []);

    expect(handle.callsTo("dataSources.retrieve").length).toBeGreaterThan(0);
    // Schema writes must target the data source; databases.update no longer
    // accepts a properties payload under 2025-09-03+.
    expect(handle.callsTo("databases.update")).toHaveLength(0);
    expect(handle.callsTo("dataSources.update").length).toBeGreaterThan(0);
    for (const call of handle.callsTo("dataSources.update")) {
      expect(call.args.data_source_id).toBeTruthy();
    }
  });

  it("provisions new databases via initial_data_source", async () => {
    const destination = new NotionDestination({
      integrationToken: "secret_test",
      parentPageId: "page_parent",
      rateLimit: { requestsPerSecond: 1_000_000, sleep: async () => undefined }
    });
    await destination.syncBatch([WORK], []);

    const creates = handle.callsTo("databases.create");
    expect(creates.length).toBe(2);
    for (const call of creates) {
      expect(call.args.initial_data_source).toBeTruthy();
      expect(call.args.properties, "schema must not be sent at the database level").toBeUndefined();
    }
  });

  it("points the Work relation at a data source", async () => {
    const destination = new NotionDestination({
      integrationToken: "secret_test",
      parentPageId: "page_parent",
      rateLimit: { requestsPerSecond: 1_000_000, sleep: async () => undefined }
    });
    await destination.syncBatch([WORK], []);

    const passagesCreate = handle
      .callsTo("databases.create")
      .find((call) => JSON.stringify(call.args.title).includes("Passages"));
    const properties = (passagesCreate?.args.initial_data_source as { properties: Record<string, never> }).properties;
    const relation = (properties.Work as { relation: Record<string, unknown> }).relation;

    expect(relation.data_source_id).toBeTruthy();
    expect(relation.database_id).toBeUndefined();
  });
});

describe("passage page-id cache", () => {
  function makeCache(seed: Record<string, string> = {}) {
    const store = new Map(Object.entries(seed));
    return {
      store,
      get: vi.fn((_scope: string, key: string) => store.get(key)),
      set: vi.fn((_scope: string, key: string, value: string) => {
        store.set(key, value);
      }),
      delete: vi.fn((_scope: string, key: string) => {
        store.delete(key);
      })
    };
  }

  beforeEach(() => {
    handle = createFakeNotionClient();
  });

  function passageLookups(): number {
    return handle.callsTo("dataSources.query").filter((call) => {
      const property = (call.args.filter as { property?: string } | undefined)?.property;
      return property === "External Passage ID" || property === "Fingerprint Hash";
    }).length;
  }

  it("skips both lookups when the fingerprint is already mapped", async () => {
    const cache = makeCache({ fp_abc123: "page_known" });
    const destination = new NotionDestination({ ...CONFIG, pageIdCache: cache });
    await destination.syncBatch([WORK], [PASSAGE]);

    expect(passageLookups()).toBe(0);
    expect(handle.callsTo("pages.update").some((call) => call.args.page_id === "page_known")).toBe(true);
  });

  it("records the page id after creating a passage", async () => {
    const cache = makeCache();
    const destination = new NotionDestination({ ...CONFIG, pageIdCache: cache });
    await destination.syncBatch([WORK], [PASSAGE]);

    expect(passageLookups()).toBe(2);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), "fp_abc123", expect.stringContaining("page_created"));
  });

  it("records the page id after matching an existing passage by query", async () => {
    handle = createFakeNotionClient({ queryResults: { "External Passage ID": [{ id: "page_existing" }] } });
    const cache = makeCache();
    const destination = new NotionDestination({ ...CONFIG, pageIdCache: cache });
    await destination.syncBatch([WORK], [PASSAGE]);

    expect(cache.set).toHaveBeenCalledWith(expect.any(String), "fp_abc123", "page_existing");
  });

  it("evicts a stale mapping and falls back to the authoritative lookup", async () => {
    handle = createFakeNotionClient({
      failures: [
        {
          method: "pages.update",
          times: 1,
          when: (args) => args.page_id === "page_deleted",
          error: new FakeNotionError("Could not find block with id: page_deleted", "object_not_found")
        }
      ]
    });
    const cache = makeCache({ fp_abc123: "page_deleted" });
    const destination = new NotionDestination({ ...CONFIG, pageIdCache: cache });

    await expect(destination.syncBatch([WORK], [PASSAGE])).resolves.toBeUndefined();

    expect(cache.delete).toHaveBeenCalledWith(expect.any(String), "fp_abc123");
    // Falls back to querying rather than blindly creating a duplicate.
    expect(passageLookups()).toBe(2);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), "fp_abc123", expect.stringContaining("page_created"));
  });

  it("degrades to the uncached path when the cache itself throws", async () => {
    const cache = {
      get: vi.fn(() => {
        throw new Error("sqlite is busy");
      }),
      set: vi.fn(() => {
        throw new Error("sqlite is busy");
      }),
      delete: vi.fn()
    };
    const destination = new NotionDestination({ ...CONFIG, pageIdCache: cache });

    await expect(destination.syncBatch([WORK], [PASSAGE])).resolves.toBeUndefined();
    expect(passageLookups()).toBe(2);
  });
});
