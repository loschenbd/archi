import crypto from "node:crypto";

export type DeviceExportRecord = {
  rawTitle: string;
  displayTitle: string;
  creator?: string;
  body: string;
  note?: string;
  positionStart?: string;
  positionEnd?: string;
  positionKind?: "page" | "location" | "unknown";
  markedAt?: string;
};

export function parseDeviceExport(raw: string): DeviceExportRecord[] {
  return raw
    .split("==========")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map(parseChunk)
    .filter((record): record is DeviceExportRecord => Boolean(record));
}

function parseChunk(chunk: string): DeviceExportRecord | null {
  const lines = chunk.split("\n").map((line) => line.trim());
  if (lines.length < 3) {
    return null;
  }

  const [titleLine = "Untitled", metaLine = "", ...bodyLines] = lines;
  const [titlePart, creatorPart] = splitTitleAndCreator(titleLine);
  const [body, note] = splitBodyAndNote(bodyLines.join("\n").trim());

  const locationRange = metaLine.match(/Location\s+(\d+)(?:-(\d+))?/i);
  const pageRange = metaLine.match(/Page\s+(\d+)(?:-(\d+))?/i);
  const markedAtMatch = metaLine.match(/\|\s*Added on\s*(.+)$/i);

  return {
    rawTitle: titleLine,
    displayTitle: titlePart,
    creator: creatorPart,
    body,
    note,
    positionStart: locationRange?.[1] ?? pageRange?.[1],
    positionEnd: locationRange?.[2] ?? pageRange?.[2],
    positionKind: locationRange ? "location" : pageRange ? "page" : "unknown",
    markedAt: markedAtMatch?.[1]
  };
}

function splitTitleAndCreator(input: string): [string, string | undefined] {
  const match = input.match(/^(.*?)\s+\((.+)\)\s*$/);
  if (!match) {
    return [input.trim(), undefined];
  }
  const [, title = "", creator = ""] = match;
  return [title.trim(), creator.trim()];
}

function splitBodyAndNote(input: string): [string, string | undefined] {
  const noteMarker = "Note:";
  const markerIndex = input.indexOf(noteMarker);
  if (markerIndex === -1) {
    return [input.trim(), undefined];
  }
  const body = input.slice(0, markerIndex).trim();
  const note = input.slice(markerIndex + noteMarker.length).trim();
  return [body, note || undefined];
}

export function computeRecordFingerprint(record: DeviceExportRecord): string {
  const canonical = [record.displayTitle, record.creator ?? "", record.body, record.positionStart ?? ""]
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, " "))
    .join("::");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export type NormalizedDeviceWork = {
  id: string;
  ingestSource: "device-export";
  displayTitle: string;
  rawTitle: string;
  creator?: string;
  workType: "book";
  labels: string[];
  isArchived: boolean;
  firstIngestedAt: string;
};

export type NormalizedDevicePassage = {
  id: string;
  workId: string;
  body: string;
  readerNote?: string;
  positionStart?: string;
  positionEnd?: string;
  positionKind?: "page" | "location" | "unknown";
  labels: string[];
  isStarred: boolean;
  isHidden: boolean;
  isArchived: boolean;
  markedAt?: string;
  ingestedAt: string;
  updatedAt: string;
  fingerprintHash: string;
};

export function normalizeDeviceExport(raw: string): {
  works: NormalizedDeviceWork[];
  passages: NormalizedDevicePassage[];
} {
  const parsed = parseDeviceExport(raw);
  const now = new Date().toISOString();
  const workIdByTitle = new Map<string, string>();
  const works: NormalizedDeviceWork[] = [];
  const passages: NormalizedDevicePassage[] = [];

  for (const record of parsed) {
    const workKey = `${record.displayTitle.toLowerCase()}::${record.creator ?? ""}`;
    let workId = workIdByTitle.get(workKey);
    if (!workId) {
      workId = createId(`work:${workKey}`);
      workIdByTitle.set(workKey, workId);
      works.push({
        id: workId,
        ingestSource: "device-export",
        displayTitle: record.displayTitle,
        rawTitle: record.rawTitle,
        creator: record.creator,
        workType: "book",
        labels: [],
        isArchived: false,
        firstIngestedAt: now
      });
    }

    passages.push({
      id: createId(`passage:${record.rawTitle}:${record.body}:${record.positionStart ?? ""}`),
      workId,
      body: record.body,
      readerNote: record.note,
      positionStart: record.positionStart,
      positionEnd: record.positionEnd,
      positionKind: record.positionKind,
      labels: [],
      isStarred: false,
      isHidden: false,
      isArchived: false,
      markedAt: record.markedAt,
      ingestedAt: now,
      updatedAt: now,
      fingerprintHash: computeRecordFingerprint(record)
    });
  }

  return { works, passages };
}

function createId(seed: string): string {
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
}
