import { Client } from "@notionhq/client";
import { applyPageMedia, chooseMedia, emojiFor, isMediaUrlRejection } from "./media.js";

export type NotionDestinationConfig = {
  integrationToken: string;
  parentPageId?: string;
  libraryDatabaseId?: string;
  passagesDatabaseId?: string;
};

export type NotionWorkInput = {
  sourceWorkId?: string;
  externalId?: string;
  displayTitle: string;
  creator?: string;
  workType: string;
  ingestSource: string;
  storeIdentifier?: string;
  coverImageUrl?: string;
  labels: string[];
  workNote?: string;
  isArchived: boolean;
  firstIngestedAt?: string;
  lastSourceChangedAt?: string;
  lastSyncedAt?: string;
  lastMarkedAt?: string;
};

export type NotionPassageInput = {
  workId: string;
  externalPassageId?: string;
  body: string;
  readerNote?: string;
  position?: string;
  positionKind?: string;
  markerColor?: string;
  markedAt?: string;
  ingestedAt?: string;
  updatedAt?: string;
  labels: string[];
  isStarred: boolean;
  isHidden: boolean;
  isArchived: boolean;
  fingerprintHash: string;
};

export type NotionViewSpec = {
  database: "Library" | "Passages";
  description: string;
  sort: Array<{ property: string; direction: "ascending" | "descending" }>;
  filter?: string;
  visibleProperties: string[];
};

export const DEFAULT_NOTION_VIEW_BUNDLE: NotionViewSpec[] = [
  {
    database: "Library",
    description: "Recent activity across all works.",
    sort: [{ property: "Latest Passage At", direction: "descending" }],
    visibleProperties: ["Title", "Creator", "Work Type", "Latest Passage At", "Passage Count", "Starred Count"]
  },
  {
    database: "Library",
    description: "Operations and sync metadata audit.",
    sort: [{ property: "Last Synced At", direction: "descending" }],
    visibleProperties: [
      "Title",
      "External ID",
      "Ingest Source",
      "First Ingested At",
      "Source Changed At",
      "Last Synced At",
      "Archived"
    ]
  },
  {
    database: "Passages",
    description: "Inbox triage queue for new passages.",
    sort: [{ property: "Marked At", direction: "descending" }],
    filter: "Status = inbox AND Archived = false",
    visibleProperties: ["Passage", "Work", "Marked At", "Status", "Starred", "Theme"]
  },
  {
    database: "Passages",
    description: "Starred passages for distillation.",
    sort: [{ property: "Marked At", direction: "descending" }],
    filter: "Starred = true AND Archived = false",
    visibleProperties: ["Passage", "Work", "Marked At", "Theme", "Atomic Note"]
  },
  {
    database: "Passages",
    description: "Operations and dedupe audit.",
    sort: [{ property: "Updated At", direction: "descending" }],
    visibleProperties: ["Passage", "Work", "External Passage ID", "Fingerprint Hash", "Ingested At", "Updated At", "Archived"]
  }
];

export type NotionSyncBatchProgressEvent = {
  phase: "works" | "passages";
  processed: number;
  total: number;
};

export type NotionSyncBatchOptions = {
  onProgress?: (event: NotionSyncBatchProgressEvent) => void;
  forceRefreshMedia?: boolean;
};

export class NotionDestination {
  private readonly client: Client;
  private readonly viewsClient: Client;
  private static readonly RETRYABLE_ERROR_CODES = new Set([
    "notionhq_client_request_timeout",
    "notionhq_client_response_error",
    "rate_limited",
    "service_unavailable",
    "internal_server_error"
  ]);

  constructor(private readonly config: NotionDestinationConfig) {
    this.client = new Client({
      auth: config.integrationToken,
      timeoutMs: 120_000
    });
    this.viewsClient = new Client({
      auth: config.integrationToken,
      timeoutMs: 120_000,
      notionVersion: "2026-03-11"
    });
  }

  async testConnection(): Promise<boolean> {
    await this.client.users.me({});
    return true;
  }

  getResolvedConfig(): Pick<NotionDestinationConfig, "parentPageId" | "libraryDatabaseId" | "passagesDatabaseId"> {
    return {
      parentPageId: this.config.parentPageId,
      libraryDatabaseId: this.config.libraryDatabaseId,
      passagesDatabaseId: this.config.passagesDatabaseId
    };
  }

  async ensureDatabases(): Promise<{ libraryDatabaseId: string; passagesDatabaseId: string }> {
    if (this.config.libraryDatabaseId && this.config.passagesDatabaseId) {
      try {
        await this.ensureDatabaseSchema(this.config.libraryDatabaseId, this.config.passagesDatabaseId);
        return {
          libraryDatabaseId: this.config.libraryDatabaseId,
          passagesDatabaseId: this.config.passagesDatabaseId
        };
      } catch (error) {
        if (!this.isNotionObjectMissingError(error)) {
          throw error;
        }
        // Saved database ids can become stale if a user deletes Notion databases.
        // Clear them and reprovision fresh databases below.
        this.config.libraryDatabaseId = undefined;
        this.config.passagesDatabaseId = undefined;
      }
    }

    const parentPageId = await this.ensureParentPageId();
    const discoveredDatabases = await this.findExistingDatabasesUnderParentPage(parentPageId);

    if (discoveredDatabases.libraryDatabaseId && discoveredDatabases.passagesDatabaseId) {
      this.config.libraryDatabaseId = discoveredDatabases.libraryDatabaseId;
      this.config.passagesDatabaseId = discoveredDatabases.passagesDatabaseId;
      await this.ensureDatabaseSchema(discoveredDatabases.libraryDatabaseId, discoveredDatabases.passagesDatabaseId);
      return {
        libraryDatabaseId: discoveredDatabases.libraryDatabaseId,
        passagesDatabaseId: discoveredDatabases.passagesDatabaseId
      };
    }

    let libraryDatabaseId = discoveredDatabases.libraryDatabaseId;
    if (!libraryDatabaseId) {
      const library = await this.withRetry(() =>
        this.client.databases.create({
          parent: { type: "page_id", page_id: parentPageId },
          title: [{ type: "text", text: { content: "Library" } }],
          properties: this.buildLibraryProperties() as never
        })
      );
      libraryDatabaseId = library.id;
    }

    let passagesDatabaseId = discoveredDatabases.passagesDatabaseId;
    if (!passagesDatabaseId) {
      const passages = await this.withRetry(() =>
        this.client.databases.create({
          parent: { type: "page_id", page_id: parentPageId },
          title: [{ type: "text", text: { content: "Passages" } }],
          properties: this.buildPassageProperties(libraryDatabaseId) as never
        })
      );
      passagesDatabaseId = passages.id;
    }

    this.config.libraryDatabaseId = libraryDatabaseId;
    this.config.passagesDatabaseId = passagesDatabaseId;
    await this.ensureDatabaseSchema(libraryDatabaseId, passagesDatabaseId);
    return { libraryDatabaseId, passagesDatabaseId };
  }

  private async ensureParentPageId(): Promise<string> {
    if (this.config.parentPageId) {
      try {
        await this.ensurePageIsActive(this.config.parentPageId);
        return this.config.parentPageId;
      } catch (error) {
        if (!this.isNotionObjectMissingError(error) && !this.isWorkspaceUnarchiveUnsupportedError(error)) {
          throw error;
        }
        // Parent page can disappear or become an unsupported archived workspace-level page.
        // Fall back to auto-discovery/provisioning.
        this.config.parentPageId = undefined;
      }
    }

    // Reuse an existing app root page before creating a new one to keep provisioning idempotent.
    const existingAppRootPageId = await this.findExistingAppRootPageId();
    if (existingAppRootPageId) {
      this.config.parentPageId = existingAppRootPageId;
      try {
        await this.ensurePageIsActive(existingAppRootPageId);
        return existingAppRootPageId;
      } catch (error) {
        if (!this.isNotionObjectMissingError(error) && !this.isWorkspaceUnarchiveUnsupportedError(error)) {
          throw error;
        }
        this.config.parentPageId = undefined;
      }
    }

    // Create an app root page directly in workspace scope as a last resort.
    try {
      const createdParentPage = await this.withRetry(() =>
        this.client.pages.create({
          parent: { type: "workspace", workspace: true } as never,
          properties: {
            title: [{ type: "text", text: { content: "Archi" } }]
          } as never
        })
      );
      this.config.parentPageId = createdParentPage.id;
      return createdParentPage.id;
    } catch {
      // Fall through to discovery of an existing accessible page.
    }

    const searchResponse = await this.withRetry(() =>
      this.client.search({
        filter: { property: "object", value: "page" },
        page_size: 1,
        sort: { direction: "descending", timestamp: "last_edited_time" }
      })
    );
    const firstPage = searchResponse.results.find((item) => item.object === "page");
    if (firstPage?.id) {
      this.config.parentPageId = firstPage.id;
      await this.ensurePageIsActive(firstPage.id);
      return firstPage.id;
    }

    throw new Error(
      "Unable to auto-provision Notion destination: no writable parent page found. Set NOTION_PARENT_PAGE_ID or connect a token with workspace page access."
    );
  }

  private async findExistingAppRootPageId(): Promise<string | null> {
    let cursor: string | undefined;
    let archivedCandidate: string | null = null;
    do {
      const response = await this.withRetry(() =>
        this.client.search({
          query: "Archi",
          filter: { property: "object", value: "page" },
          page_size: 100,
          start_cursor: cursor,
          sort: { direction: "descending", timestamp: "last_edited_time" }
        })
      );
      for (const page of response.results as Array<Record<string, unknown>>) {
        if (page.object !== "page" || typeof page.id !== "string") {
          continue;
        }
        const pageTitle = this.getPageTitle(page).trim().toLowerCase();
        if (pageTitle !== "archi") {
          continue;
        }
        const isArchived = Boolean(page.archived) || Boolean(page.in_trash);
        if (!isArchived) {
          return page.id;
        }
        if (!archivedCandidate) {
          archivedCandidate = page.id;
        }
      }
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);
    return archivedCandidate;
  }

  private getPageTitle(page: Record<string, unknown>): string {
    const properties = page.properties as Record<string, { type?: string; title?: Array<{ plain_text?: string }> }> | undefined;
    if (!properties) {
      return "";
    }
    for (const property of Object.values(properties)) {
      if (property?.type !== "title") {
        continue;
      }
      return (property.title ?? []).map((chunk) => chunk.plain_text ?? "").join("").trim();
    }
    return "";
  }

  private async findExistingDatabasesUnderParentPage(
    parentPageId: string
  ): Promise<{ libraryDatabaseId?: string; passagesDatabaseId?: string }> {
    const childDatabaseIds: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await this.withRetry(() =>
        this.client.blocks.children.list({
          block_id: parentPageId,
          page_size: 100,
          start_cursor: cursor
        })
      );
      for (const block of response.results as Array<{ type?: string; id?: string }>) {
        if (block.type === "child_database" && block.id) {
          childDatabaseIds.push(block.id);
        }
      }
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    let libraryDatabaseId: string | undefined;
    let passagesDatabaseId: string | undefined;
    for (const childDatabaseId of childDatabaseIds) {
      const database = (await this.withRetry(() =>
        this.client.databases.retrieve({ database_id: childDatabaseId })
      )) as { title?: Array<{ plain_text?: string }> };
      const databaseTitle = (database.title ?? []).map((chunk) => chunk.plain_text ?? "").join("").trim().toLowerCase();
      if (databaseTitle === "library" && !libraryDatabaseId) {
        libraryDatabaseId = childDatabaseId;
      } else if (databaseTitle === "passages" && !passagesDatabaseId) {
        passagesDatabaseId = childDatabaseId;
      }
      if (libraryDatabaseId && passagesDatabaseId) {
        break;
      }
    }

    return {
      libraryDatabaseId,
      passagesDatabaseId
    };
  }

  private async ensurePageIsActive(pageId: string): Promise<void> {
    const page = (await this.withRetry(() => this.client.pages.retrieve({ page_id: pageId }))) as {
      archived?: boolean;
      in_trash?: boolean;
    };
    if (!page.archived && !page.in_trash) {
      return;
    }
    await this.withRetry(() =>
      this.client.pages.update({
        page_id: pageId,
        archived: false
      })
    );
  }

  async syncBatch(works: NotionWorkInput[], passages: NotionPassageInput[], options?: NotionSyncBatchOptions): Promise<void> {
    const { libraryDatabaseId, passagesDatabaseId } = await this.ensureDatabases();
    const workPageBySourceId = new Map<string, string>();
    const syncedAt = new Date().toISOString();
    options?.onProgress?.({ phase: "works", processed: 0, total: works.length });
    const forceRefreshMedia = options?.forceRefreshMedia ?? false;

    for (const [index, work] of works.entries()) {
      const normalizedWork: NotionWorkInput = {
        ...work,
        externalId: this.resolveWorkExternalId(work),
        lastSyncedAt: syncedAt
      };
      const pageId = await this.upsertLibraryWork(libraryDatabaseId, passagesDatabaseId, normalizedWork, forceRefreshMedia);
      if (work.sourceWorkId) {
        workPageBySourceId.set(work.sourceWorkId, pageId);
      }
      options?.onProgress?.({ phase: "works", processed: index + 1, total: works.length });
    }
    options?.onProgress?.({ phase: "passages", processed: 0, total: passages.length });

    for (const [index, passage] of passages.entries()) {
      const workPageId = workPageBySourceId.get(passage.workId);
      if (!workPageId) {
        options?.onProgress?.({ phase: "passages", processed: index + 1, total: passages.length });
        continue;
      }
      await this.upsertPassage(passagesDatabaseId, workPageId, passage);
      options?.onProgress?.({ phase: "passages", processed: index + 1, total: passages.length });
    }
  }

  private async upsertLibraryWork(
    libraryDatabaseId: string,
    passagesDatabaseId: string,
    work: NotionWorkInput,
    forceRefreshMedia: boolean
  ): Promise<string> {
    const externalId = this.normalizeTextValue(work.externalId);
    const existing =
      (await this.findOneByRichText(libraryDatabaseId, "External ID", externalId)) ??
      (await this.findLegacyLibraryWorkWithoutExternalId(libraryDatabaseId, work));
    const properties = {
      Title: { title: [{ type: "text", text: { content: this.titleText(work.displayTitle, "Untitled") } }] },
      Creator: { rich_text: this.richText(work.creator) },
      "Work Type": { select: work.workType ? { name: work.workType } : null },
      "Ingest Source": { select: work.ingestSource ? { name: work.ingestSource } : null },
      "Store ID": { rich_text: this.richText(work.storeIdentifier) },
      Cover: { url: work.coverImageUrl ?? null },
      Labels: { multi_select: work.labels.map((label) => ({ name: label })) },
      "Work Note": { rich_text: this.richText(work.workNote) },
      "First Ingested At": { date: work.firstIngestedAt ? { start: work.firstIngestedAt } : null },
      "Source Changed At": { date: work.lastSourceChangedAt ? { start: work.lastSourceChangedAt } : null },
      "Last Synced At": { date: work.lastSyncedAt ? { start: work.lastSyncedAt } : null },
      "Last Marked At": { date: work.lastMarkedAt ? { start: work.lastMarkedAt } : null },
      "External ID": { rich_text: this.richText(externalId) },
      Archived: { checkbox: work.isArchived }
    };

    let pageId: string;
    let isNewPage: boolean;
    if (existing) {
      await this.updatePageProperties(existing.id, properties);
      pageId = existing.id;
      isNewPage = false;
    } else {
      const created = await this.withRetry(() =>
        this.client.pages.create({
          parent: { database_id: libraryDatabaseId },
          properties: properties as never
        })
      );
      pageId = created.id;
      isNewPage = true;
    }

    await this.applyMediaForWork(pageId, work, forceRefreshMedia, isNewPage);
    await this.tryEnsureWorkPageQuotesFeed(pageId, passagesDatabaseId);
    return pageId;
  }

  private async applyMediaForWork(
    pageId: string,
    work: NotionWorkInput,
    forceRefreshMedia: boolean,
    isNewPage: boolean
  ): Promise<void> {
    const desired = chooseMedia(work);
    try {
      await this.withRetry(() => applyPageMedia(this.client as never, pageId, desired, { force: forceRefreshMedia, isNewPage }));
    } catch (error) {
      if (isMediaUrlRejection(error)) {
        try {
          await this.withRetry(() =>
            this.client.pages.update({
              page_id: pageId,
              icon: { type: "emoji", emoji: emojiFor(work.workType) }
            } as never)
          );
        } catch {
          // Emoji fallback failed too. Sync stays alive; the page just won't get media this run.
        }
        return;
      }
      // Non-URL-rejection error: log and move on. Sync continues.
      console.warn(`[notion-destination] applyPageMedia failed for page ${pageId}:`, error);
    }
  }

  private async findLegacyLibraryWorkWithoutExternalId(
    libraryDatabaseId: string,
    work: NotionWorkInput
  ): Promise<{ id: string } | null> {
    const title = this.titleText(work.displayTitle, "Untitled");
    const creator = this.normalizeTextValue(work.creator);
    const filters: Record<string, unknown>[] = [
      {
        property: "External ID",
        rich_text: { is_empty: true }
      },
      {
        property: "Title",
        title: { equals: title }
      },
      {
        property: "Ingest Source",
        select: { equals: work.ingestSource }
      }
    ];
    if (creator) {
      filters.push({
        property: "Creator",
        rich_text: { equals: creator }
      });
    } else {
      filters.push({
        property: "Creator",
        rich_text: { is_empty: true }
      });
    }
    const queried = await this.withRetry(() =>
      this.client.databases.query({
        database_id: libraryDatabaseId,
        page_size: 1,
        filter: {
          and: filters
        } as never
      })
    );
    if (queried.results.length === 0) {
      return null;
    }
    const firstResult = queried.results[0];
    if (!firstResult) {
      return null;
    }
    return { id: firstResult.id };
  }

  private async upsertPassage(passagesDatabaseId: string, workPageId: string, passage: NotionPassageInput): Promise<void> {
    const existing =
      (await this.findOneByRichText(passagesDatabaseId, "External Passage ID", passage.externalPassageId)) ??
      (await this.findOneByRichText(passagesDatabaseId, "Fingerprint Hash", passage.fingerprintHash));

    const properties = {
      Passage: { title: [{ type: "text", text: { content: this.titleText(passage.body, "Passage") } }] },
      "Reader Note": { rich_text: this.richText(passage.readerNote) },
      Work: { relation: [{ id: workPageId }] },
      Position: { rich_text: this.richText(passage.position) },
      "Position Kind": { select: passage.positionKind ? { name: passage.positionKind } : null },
      "Marker Color": { select: passage.markerColor ? { name: passage.markerColor } : null },
      "Marked At": { date: passage.markedAt ? { start: passage.markedAt } : null },
      "Ingested At": { date: passage.ingestedAt ? { start: passage.ingestedAt } : null },
      "Updated At": { date: passage.updatedAt ? { start: passage.updatedAt } : null },
      Labels: { multi_select: passage.labels.map((label) => ({ name: label })) },
      Starred: { checkbox: passage.isStarred },
      Hidden: { checkbox: passage.isHidden },
      "External Passage ID": { rich_text: this.richText(passage.externalPassageId) },
      "Fingerprint Hash": { rich_text: this.richText(passage.fingerprintHash) },
      Archived: { checkbox: passage.isArchived }
    };

    if (existing) {
      await this.updatePageProperties(existing.id, properties);
      return;
    }

    await this.withRetry(() =>
      this.client.pages.create({
        parent: { database_id: passagesDatabaseId },
        properties: properties as never
      })
    );
  }

  private async findOneByRichText(databaseId: string, propertyName: string, value: string | undefined): Promise<{ id: string } | null> {
    if (!value) {
      return null;
    }
    const queried = await this.withRetry(() =>
      this.client.databases.query({
        database_id: databaseId,
        page_size: 1,
        filter: {
          property: propertyName,
          rich_text: { equals: value }
        } as never
      })
    );
    if (queried.results.length === 0) {
      return null;
    }
    const firstResult = queried.results[0];
    if (!firstResult) {
      return null;
    }
    return { id: firstResult.id };
  }

  private async updatePageProperties(pageId: string, properties: Record<string, unknown>): Promise<void> {
    try {
      await this.withRetry(() => this.client.pages.update({ page_id: pageId, properties: properties as never }));
      return;
    } catch (error) {
      if (!this.isArchivedBlockValidationError(error)) {
        throw error;
      }
    }

    // Notion can return existing rows that were archived manually. Unarchive and retry update.
    await this.withRetry(() => this.client.pages.update({ page_id: pageId, archived: false as never }));
    await this.withRetry(() => this.client.pages.update({ page_id: pageId, properties: properties as never }));
  }

  private async ensureWorkPageQuotesFeed(pageId: string, passagesDatabaseId: string): Promise<void> {
    const tryEnsure = async (): Promise<void> => {
      const passagesDataSourceId = await this.getPrimaryDataSourceId(passagesDatabaseId);
      if (!passagesDataSourceId) {
        return;
      }
      let linkedDatabaseId = await this.findLinkedDatabaseIdOnPage(pageId, passagesDataSourceId);

      if (!linkedDatabaseId) {
        const createdView = await this.withRetry(() =>
          this.viewsClient.request<{ parent?: { type?: string; database_id?: string } }>({
            path: "views",
            method: "post",
            body: {
              create_database: {
                parent: {
                  type: "page_id",
                  page_id: pageId
                }
              },
              data_source_id: passagesDataSourceId,
              name: "Quotes Feed",
              type: "gallery",
              filter: {
                property: "Work",
                relation: { contains: pageId }
              },
              sorts: [{ property: "Marked At", direction: "descending" }],
              configuration: {
                type: "gallery",
                card_layout: "list"
              }
            }
          })
        );
        if (createdView.parent?.type === "database_id" && createdView.parent.database_id) {
          linkedDatabaseId = createdView.parent.database_id;
        } else {
          linkedDatabaseId = await this.findLinkedDatabaseIdOnPage(pageId, passagesDataSourceId);
        }
      }

      if (!linkedDatabaseId) {
        return;
      }

      const viewsResponse = await this.withRetry(() =>
        this.viewsClient.request<{ results?: Array<{ id?: string; name?: string }> }>({
          path: "views",
          method: "get",
          query: {
            database_id: linkedDatabaseId
          }
        })
      );
      const feedView =
        viewsResponse.results?.find((view) => (view.name ?? "").trim().toLowerCase() === "quotes feed") ??
        viewsResponse.results?.[0];
      if (!feedView?.id) {
        return;
      }

      await this.withRetry(() =>
        this.viewsClient.request({
          path: `views/${feedView.id}`,
          method: "patch",
          body: {
            name: "Quotes Feed",
            type: "gallery",
            filter: {
              property: "Work",
              relation: { contains: pageId }
            },
            sorts: [{ property: "Marked At", direction: "descending" }],
            configuration: {
              type: "gallery",
              card_layout: "list"
            }
          }
        })
      );
    };

    try {
      await tryEnsure();
    } catch (error) {
      if (!this.isArchivedBlockValidationError(error)) {
        throw error;
      }
      await this.withRetry(() => this.client.pages.update({ page_id: pageId, archived: false as never }));
      await tryEnsure();
    }
  }

  private async tryEnsureWorkPageQuotesFeed(pageId: string, passagesDatabaseId: string): Promise<void> {
    try {
      await this.ensureWorkPageQuotesFeed(pageId, passagesDatabaseId);
    } catch {
      // Linked view provisioning is best-effort; sync should still succeed without it.
    }
  }

  private async getPrimaryDataSourceId(databaseId: string): Promise<string | null> {
    const database = await this.withRetry(() =>
      this.viewsClient.request<{ data_sources?: Array<{ id?: string }> }>({
        path: `databases/${databaseId}`,
        method: "get"
      })
    );
    const firstDataSource = database.data_sources?.[0];
    return firstDataSource?.id ?? null;
  }

  private async findLinkedDatabaseIdOnPage(pageId: string, dataSourceId: string): Promise<string | null> {
    const childDatabaseIds: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await this.withRetry(() =>
        this.client.blocks.children.list({
          block_id: pageId,
          page_size: 100,
          start_cursor: cursor
        })
      );
      for (const block of response.results as Array<{ type?: string; id?: string }>) {
        if (block.type === "child_database" && block.id) {
          childDatabaseIds.push(block.id);
        }
      }
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    for (const childDatabaseId of childDatabaseIds) {
      const database = await this.withRetry(() =>
        this.viewsClient.request<{ data_sources?: Array<{ id?: string }> }>({
          path: `databases/${childDatabaseId}`,
          method: "get"
        })
      );
      const matchesDataSource = (database.data_sources ?? []).some((dataSource) => dataSource.id === dataSourceId);
      if (matchesDataSource) {
        return childDatabaseId;
      }
    }
    return null;
  }

  private resolveWorkExternalId(work: NotionWorkInput): string | undefined {
    return this.normalizeTextValue(work.externalId) ?? this.normalizeTextValue(work.sourceWorkId);
  }

  private normalizeTextValue(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    if (!normalized) {
      return undefined;
    }
    return normalized.slice(0, 2000);
  }

  private richText(value: string | undefined): Array<{ type: "text"; text: { content: string } }> {
    const normalized = this.normalizeTextValue(value);
    if (!normalized) {
      return [];
    }
    return [{ type: "text", text: { content: normalized } }];
  }

  private titleText(value: string | undefined, fallback: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      return fallback;
    }
    // Notion title text content has a 2000-char limit.
    return normalized.slice(0, 2000);
  }

  private buildLibraryProperties(): Record<string, unknown> {
    return {
      Title: { title: {} },
      Creator: { rich_text: {} },
      "Work Type": { select: { options: [] } },
      "Ingest Source": { select: { options: [] } },
      "Store ID": { rich_text: {} },
      Cover: { url: {} },
      Labels: { multi_select: { options: [] } },
      "Work Note": { rich_text: {} },
      "Last Marked At": { date: {} },
      "External ID": { rich_text: {} },
      "First Ingested At": { date: {} },
      "Source Changed At": { date: {} },
      "Last Synced At": { date: {} },
      Priority: { select: { options: [{ name: "high", color: "red" }, { name: "medium", color: "yellow" }, { name: "low", color: "gray" }] } },
      Queue: { select: { options: [{ name: "inbox", color: "blue" }, { name: "active", color: "green" }, { name: "someday", color: "gray" }] } },
      "Next Review": { date: {} },
      Archived: { checkbox: {} }
    };
  }

  private buildPassageProperties(libraryDatabaseId: string): Record<string, unknown> {
    return {
      Passage: { title: {} },
      "Reader Note": { rich_text: {} },
      Work: { relation: { database_id: libraryDatabaseId, type: "single_property", single_property: {} } },
      Position: { rich_text: {} },
      "Position Kind": { select: { options: [] } },
      "Marker Color": { select: { options: [] } },
      "Marked At": { date: {} },
      "Ingested At": { date: {} },
      "Updated At": { date: {} },
      Labels: { multi_select: { options: [] } },
      Status: {
        select: {
          options: [
            { name: "inbox", color: "blue" },
            { name: "reviewing", color: "yellow" },
            { name: "distilled", color: "green" },
            { name: "archived", color: "gray" }
          ]
        }
      },
      Theme: { multi_select: { options: [] } },
      "Atomic Note": { rich_text: {} },
      Starred: { checkbox: {} },
      Hidden: { checkbox: {} },
      "External Passage ID": { rich_text: {} },
      "Fingerprint Hash": { rich_text: {} },
      Archived: { checkbox: {} }
    };
  }

  private async ensureDatabaseSchema(libraryDatabaseId: string, passagesDatabaseId: string): Promise<void> {
    const [library, passages] = await Promise.all([
      this.withRetry(() => this.client.databases.retrieve({ database_id: libraryDatabaseId })),
      this.withRetry(() => this.client.databases.retrieve({ database_id: passagesDatabaseId }))
    ]);
    const libraryProperties = this.buildLibraryProperties();
    const passageProperties = this.buildPassageProperties(libraryDatabaseId);
    const relationPropertyName = this.findRelationPropertyName(library, passagesDatabaseId);
    if (relationPropertyName) {
      libraryProperties["Passage Count"] = {
        rollup: { relation_property_name: relationPropertyName, rollup_property_name: "Passage", function: "count" }
      };
      libraryProperties["Starred Count"] = {
        rollup: { relation_property_name: relationPropertyName, rollup_property_name: "Starred", function: "checked" }
      };
      libraryProperties["Latest Passage At"] = {
        rollup: { relation_property_name: relationPropertyName, rollup_property_name: "Marked At", function: "latest_date" }
      };
    }
    await this.addMissingProperties(libraryDatabaseId, libraryProperties, library);
    await this.addMissingProperties(passagesDatabaseId, passageProperties, passages);
  }

  private async addMissingProperties(
    databaseId: string,
    required: Record<string, unknown>,
    currentDatabase: Awaited<ReturnType<Client["databases"]["retrieve"]>>
  ): Promise<void> {
    const currentProperties = currentDatabase.properties as Record<string, unknown>;
    const missingProperties = Object.fromEntries(
      Object.entries(required).filter(([propertyName]) => !Object.hasOwn(currentProperties, propertyName))
    );
    if (Object.keys(missingProperties).length === 0) {
      return;
    }
    await this.withRetry(() =>
      this.client.databases.update({
        database_id: databaseId,
        properties: missingProperties as never
      })
    );
  }

  private findRelationPropertyName(
    libraryDatabase: Awaited<ReturnType<Client["databases"]["retrieve"]>>,
    passagesDatabaseId: string
  ): string | null {
    const properties = libraryDatabase.properties as Record<string, { type?: string; relation?: { database_id?: string } }>;
    for (const [propertyName, property] of Object.entries(properties)) {
      if (property.type !== "relation") {
        continue;
      }
      if (property.relation?.database_id === passagesDatabaseId) {
        return propertyName;
      }
    }
    return null;
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!this.isRetryableError(error) || attempt === 7) {
          break;
        }
        const baseDelayMs = Math.min(500 * 2 ** attempt, 20_000);
        const jitterMs = Math.floor(Math.random() * 200);
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs + jitterMs));
      }
    }
    throw lastError;
  }

  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const code = (error as Error & { code?: string }).code;
    if (code && NotionDestination.RETRYABLE_ERROR_CODES.has(code)) {
      return true;
    }
    return /timeout|timed out|rate limit|temporar|service unavailable|econnreset|etimedout/i.test(error.message);
  }

  private isNotionObjectMissingError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const code = (error as Error & { code?: string }).code;
    if (code === "object_not_found") {
      return true;
    }
    return /could not find .* with id|object_not_found|not found/i.test(error.message);
  }

  private isArchivedBlockValidationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const code = (error as Error & { code?: string }).code;
    if (code !== "validation_error") {
      return false;
    }
    return /can't edit block that is archived|unarchive the block/i.test(error.message);
  }

  private isWorkspaceUnarchiveUnsupportedError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const code = (error as Error & { code?: string }).code;
    if (code !== "validation_error") {
      return false;
    }
    return /unarchiving workspace level pages not supported by the api/i.test(error.message);
  }
}
