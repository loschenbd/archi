export type IngestSource = "cloud-notebook" | "device-export";

export type WorkType = "book" | "article" | "periodical" | "document" | "other";

export type PositionKind = "page" | "location" | "offset" | "order" | "unknown";

export type SyncJobStatus = "idle" | "running" | "success" | "needs_auth" | "partial_success" | "failed";

export type Work = {
  id: string;
  ingestSource: IngestSource;
  externalId?: string;
  displayTitle: string;
  rawTitle: string;
  creator?: string;
  workType: WorkType;
  storeIdentifier?: string;
  coverImageUrl?: string;
  workNote?: string;
  labels: string[];
  isArchived: boolean;
  firstIngestedAt: string;
  lastSourceChangedAt?: string;
  lastSyncedAt?: string;
  rawPayload?: unknown;
};

export type Passage = {
  id: string;
  workId: string;
  externalPassageId?: string;
  body: string;
  readerNote?: string;
  positionStart?: string;
  positionEnd?: string;
  positionKind?: PositionKind;
  markerColor?: string;
  labels: string[];
  isStarred: boolean;
  isHidden: boolean;
  isArchived: boolean;
  markedAt?: string;
  ingestedAt: string;
  updatedAt: string;
  fingerprintHash: string;
  rawPayload?: unknown;
};

export type SyncJob = {
  id: string;
  source: IngestSource;
  status: SyncJobStatus;
  resumeCursor?: string;
  changedAfter?: string;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
};
