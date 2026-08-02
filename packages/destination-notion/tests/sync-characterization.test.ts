import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeNotionError,
  createFakeNotionClient,
  type FakeClientHandle,
  type FakeClientOptions
} from "./helpers/fakeNotionClient.js";

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

function work(overrides: Record<string, unknown> = {}) {
  return {
    sourceWorkId: "work_1",
    displayTitle: "Thinking, Fast and Slow",
    creator: "Daniel Kahneman",
    workType: "book",
    ingestSource: "device_export",
    labels: [],
    isArchived: false,
    ...overrides
  } as never;
}

function passage(overrides: Record<string, unknown> = {}) {
  return {
    workId: "work_1",
    externalPassageId: "ext_p1",
    body: "The illusion that we understand the past fosters overconfidence.",
    labels: [],
    isStarred: false,
    isHidden: false,
    isArchived: false,
    fingerprintHash: "fp_abc123",
    ...overrides
  } as never;
}

/** Query calls are the lookup traffic; both namespaces count so this survives migration. */
function queryCalls(): number {
  return handle.callsTo("databases.query").length + handle.callsTo("dataSources.query").length;
}

function setup(options: FakeClientOptions = {}): void {
  handle = createFakeNotionClient(options);
}

describe("NotionDestination sync — characterization", () => {
  beforeEach(() => {
    setup();
  });

  it("looks up a passage by External Passage ID, then Fingerprint Hash, then creates", async () => {
    const destination = new NotionDestination({ ...CONFIG });
    await destination.syncBatch([work()], [passage()]);

    const passageQueries = [...handle.callsTo("databases.query"), ...handle.callsTo("dataSources.query")].filter(
      (call) => {
        const filter = call.args.filter as { property?: string } | undefined;
        return filter?.property === "External Passage ID" || filter?.property === "Fingerprint Hash";
      }
    );

    expect(passageQueries.map((call) => (call.args.filter as { property: string }).property)).toEqual([
      "External Passage ID",
      "Fingerprint Hash"
    ]);

    // Both lookups missed, so the passage is created rather than updated.
    const createdPassage = handle
      .callsTo("pages.create")
      .find((call) => Object.hasOwn(call.args.properties as object, "Fingerprint Hash"));
    expect(createdPassage).toBeDefined();
  });

  it("short-circuits the second lookup when External Passage ID already matches", async () => {
    setup({ queryResults: { "External Passage ID": [{ id: "page_existing_passage" }] } });
    const destination = new NotionDestination({ ...CONFIG });
    await destination.syncBatch([work()], [passage()]);

    const fingerprintLookups = [...handle.callsTo("databases.query"), ...handle.callsTo("dataSources.query")].filter(
      (call) => (call.args.filter as { property?: string } | undefined)?.property === "Fingerprint Hash"
    );
    expect(fingerprintLookups).toHaveLength(0);

    const updatedExisting = handle
      .callsTo("pages.update")
      .some((call) => call.args.page_id === "page_existing_passage");
    expect(updatedExisting).toBe(true);
  });

  it("costs two lookups plus one write per new passage (documents the pre-cache request budget)", async () => {
    const destination = new NotionDestination({ ...CONFIG });
    handle.reset();
    await destination.syncBatch([], [passage()]);

    // No work page was synced, so the passage is skipped entirely.
    expect(queryCalls()).toBe(0);

    setup();
    const second = new NotionDestination({ ...CONFIG });
    await second.syncBatch([work()], [passage()]);

    const passageLookups = [...handle.callsTo("databases.query"), ...handle.callsTo("dataSources.query")].filter(
      (call) => {
        const property = (call.args.filter as { property?: string } | undefined)?.property;
        return property === "External Passage ID" || property === "Fingerprint Hash";
      }
    );
    expect(passageLookups).toHaveLength(2);
  });

  it("skips passages whose work produced no page", async () => {
    const destination = new NotionDestination({ ...CONFIG });
    await destination.syncBatch([work()], [passage({ workId: "work_orphan" })]);

    const passageCreates = handle
      .callsTo("pages.create")
      .filter((call) => Object.hasOwn(call.args.properties as object, "Fingerprint Hash"));
    expect(passageCreates).toHaveLength(0);
  });

  it("recovers from an archived row by unarchiving, then reapplying properties", async () => {
    setup({
      queryResults: { "External Passage ID": [{ id: "page_archived" }] },
      failures: [
        {
          method: "pages.update",
          times: 1,
          // Only the passage property write, not the best-effort media update.
          when: (args) => Object.hasOwn((args.properties ?? {}) as object, "Fingerprint Hash"),
          error: new FakeNotionError("Can't edit block that is archived. You must unarchive the block", "validation_error")
        }
      ]
    });
    const destination = new NotionDestination({ ...CONFIG });
    await destination.syncBatch([work()], [passage()]);

    const unarchive = handle.callsTo("pages.update").find((call) => call.args.archived === false);
    expect(unarchive).toBeDefined();
    expect(unarchive?.args.page_id).toBe("page_archived");

    // The property write is reapplied after unarchiving.
    const reapplied = handle
      .callsTo("pages.update")
      .filter((call) => Object.hasOwn((call.args.properties ?? {}) as object, "Fingerprint Hash"));
    expect(reapplied.length).toBeGreaterThanOrEqual(2);
  });

  it("retries retryable errors instead of failing the batch", async () => {
    setup({
      failures: [{ method: "pages.create", times: 1, error: new FakeNotionError("rate limited", "rate_limited") }]
    });
    const destination = new NotionDestination({ ...CONFIG });

    await expect(destination.syncBatch([work()], [])).resolves.toBeUndefined();
    expect(handle.callsTo("pages.create").length).toBeGreaterThanOrEqual(2);
  });

  it("retries a 529 service_overload instead of failing the batch", async () => {
    setup({
      failures: [
        { method: "pages.create", times: 1, error: new FakeNotionError("Notion is overloaded", "service_overload") }
      ]
    });
    const destination = new NotionDestination({ ...CONFIG });

    await expect(destination.syncBatch([work()], [])).resolves.toBeUndefined();
    expect(handle.callsTo("pages.create").length).toBeGreaterThanOrEqual(2);
  });

  it("waits the server-supplied Retry-After rather than its own backoff", async () => {
    const slept: number[] = [];
    const rateLimited = new FakeNotionError("rate limited", "rate_limited") as FakeNotionError & {
      headers: Record<string, string>;
    };
    rateLimited.headers = { "retry-after": "5" };

    setup({ failures: [{ method: "pages.create", times: 1, error: rateLimited }] });
    const destination = new NotionDestination({
      ...CONFIG,
      rateLimit: {
        requestsPerSecond: 1_000_000,
        sleep: async (milliseconds: number) => {
          slept.push(milliseconds);
        }
      }
    });

    await destination.syncBatch([work()], []);

    // 5s from the header, not the ~500ms first-attempt backoff.
    expect(slept).toContain(5000);
  });

  it("reports progress for both phases", async () => {
    const destination = new NotionDestination({ ...CONFIG });
    const events: Array<{ phase: string; processed: number; total: number }> = [];
    await destination.syncBatch([work()], [passage()], {
      onProgress: (event) => events.push(event)
    });

    expect(events.filter((event) => event.phase === "works").at(-1)).toEqual({
      phase: "works",
      processed: 1,
      total: 1
    });
    expect(events.filter((event) => event.phase === "passages").at(-1)).toEqual({
      phase: "passages",
      processed: 1,
      total: 1
    });
  });
});
