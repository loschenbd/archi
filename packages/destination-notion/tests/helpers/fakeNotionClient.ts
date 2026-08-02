import { vi } from "vitest";

/**
 * Records every Notion SDK call the destination makes, so tests can assert on
 * the *sequence and shape* of API traffic rather than on network behaviour.
 *
 * The fake deliberately models both the pre-2025-09-03 (`databases.query`,
 * `databases.update`) and post-split (`dataSources.query`, `dataSources.update`)
 * namespaces. Characterization tests written against this fake keep their
 * assertions when the destination migrates from one to the other — only the
 * recorded `method` names change.
 */
export type RecordedCall = { method: string; args: Record<string, unknown> };

export class FakeNotionError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/**
 * `Object.hasOwn(x, anything) === true`, so `addMissingProperties` treats the
 * schema as already complete and skips the update call. Keeps provisioning
 * noise out of tests that care about upsert traffic.
 */
export const ALL_PROPERTIES_PRESENT = new Proxy({} as Record<string, unknown>, {
  getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: {} }),
  has: () => true,
  get: () => ({})
});

export type FakeClientOptions = {
  /** Rows returned by query calls, keyed by the rich-text property filtered on. */
  queryResults?: Record<string, Array<{ id: string }>>;
  /**
   * Per-method error to throw, for retry/recovery tests. `when` narrows the
   * failure to specific calls — needed because several code paths hit the same
   * SDK method and best-effort paths (media, linked views) swallow errors.
   */
  failures?: Array<{ method: string; times: number; error: Error; when?: (args: Record<string, unknown>) => boolean }>;
  databaseProperties?: Record<string, unknown>;
};

export type FakeClientHandle = {
  ClientMock: new (options: Record<string, unknown>) => unknown;
  calls: RecordedCall[];
  constructorOptions: Array<Record<string, unknown>>;
  callsTo: (method: string) => RecordedCall[];
  reset: () => void;
};

export function createFakeNotionClient(options: FakeClientOptions = {}): FakeClientHandle {
  const calls: RecordedCall[] = [];
  const constructorOptions: Array<Record<string, unknown>> = [];
  const remainingFailures = (options.failures ?? []).map((failure) => ({ ...failure }));

  let createdPageCounter = 0;

  const record = (method: string, args: Record<string, unknown>): void => {
    calls.push({ method, args });
    const failure = remainingFailures.find(
      (candidate) => candidate.method === method && candidate.times > 0 && (candidate.when?.(args) ?? true)
    );
    if (failure) {
      failure.times -= 1;
      throw failure.error;
    }
  };

  /** Resolves which rows a query returns based on the rich-text property it filters on. */
  const resolveQueryResults = (args: Record<string, unknown>): Array<{ id: string }> => {
    const filter = args.filter as { property?: string; and?: Array<{ property?: string }> } | undefined;
    const property = filter?.property ?? filter?.and?.find((clause) => clause.property !== "External ID")?.property;
    if (!property) {
      return [];
    }
    return options.queryResults?.[property] ?? [];
  };

  const databaseStub = {
    id: "db_stub",
    title: [{ plain_text: "Library" }],
    properties: options.databaseProperties ?? ALL_PROPERTIES_PRESENT,
    data_sources: [{ id: "ds_stub", name: "Default" }]
  };

  class ClientMock {
    databases: Record<string, unknown>;
    dataSources: Record<string, unknown>;
    pages: Record<string, unknown>;
    blocks: Record<string, unknown>;
    users: Record<string, unknown>;
    search: unknown;
    request: unknown;

    constructor(clientOptions: Record<string, unknown>) {
      constructorOptions.push(clientOptions);

      this.databases = {
        create: vi.fn(async (args: Record<string, unknown>) => {
          record("databases.create", args);
          return { id: "db_created", data_sources: [{ id: "ds_created", name: "Default" }] };
        }),
        retrieve: vi.fn(async (args: Record<string, unknown>) => {
          record("databases.retrieve", args);
          return databaseStub;
        }),
        query: vi.fn(async (args: Record<string, unknown>) => {
          record("databases.query", args);
          return { results: resolveQueryResults(args), has_more: false, next_cursor: null };
        }),
        update: vi.fn(async (args: Record<string, unknown>) => {
          record("databases.update", args);
          return databaseStub;
        })
      };

      // Post-split namespace. Present from the start so assertions survive migration.
      this.dataSources = {
        retrieve: vi.fn(async (args: Record<string, unknown>) => {
          record("dataSources.retrieve", args);
          return databaseStub;
        }),
        query: vi.fn(async (args: Record<string, unknown>) => {
          record("dataSources.query", args);
          return { results: resolveQueryResults(args), has_more: false, next_cursor: null };
        }),
        update: vi.fn(async (args: Record<string, unknown>) => {
          record("dataSources.update", args);
          return databaseStub;
        }),
        create: vi.fn(async (args: Record<string, unknown>) => {
          record("dataSources.create", args);
          return { id: "ds_created" };
        })
      };

      this.pages = {
        create: vi.fn(async (args: Record<string, unknown>) => {
          record("pages.create", args);
          createdPageCounter += 1;
          return { id: `page_created_${createdPageCounter}` };
        }),
        retrieve: vi.fn(async (args: Record<string, unknown>) => {
          record("pages.retrieve", args);
          return { id: args.page_id, archived: false, in_trash: false, icon: { type: "emoji" } };
        }),
        update: vi.fn(async (args: Record<string, unknown>) => {
          record("pages.update", args);
          return { id: args.page_id };
        })
      };

      this.blocks = {
        children: {
          list: vi.fn(async (args: Record<string, unknown>) => {
            record("blocks.children.list", args);
            return { results: [], has_more: false, next_cursor: null };
          })
        }
      };

      this.users = {
        me: vi.fn(async (args: Record<string, unknown>) => {
          record("users.me", args);
          return { id: "bot" };
        })
      };

      this.search = vi.fn(async (args: Record<string, unknown>) => {
        record("search", args);
        return { results: [], has_more: false, next_cursor: null };
      });

      this.request = vi.fn(async (args: Record<string, unknown>) => {
        record(`request:${String(args.method).toLowerCase()} ${String(args.path).split("/")[0]}`, args);
        return { data_sources: [{ id: "ds_stub" }], results: [], parent: {} };
      });
    }
  }

  return {
    ClientMock: ClientMock as unknown as new (options: Record<string, unknown>) => unknown,
    calls,
    constructorOptions,
    callsTo: (method: string) => calls.filter((call) => call.method === method),
    reset: () => {
      calls.length = 0;
      constructorOptions.length = 0;
      createdPageCounter = 0;
    }
  };
}
