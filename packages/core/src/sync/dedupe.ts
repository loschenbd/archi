import crypto from "node:crypto";
import type { Passage } from "../types.js";

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeFingerprintHash(input: {
  displayTitle: string;
  creator?: string;
  body: string;
  positionStart?: string;
  sourceScope?: string;
}): string {
  const canonical = [
    normalize(input.displayTitle),
    normalize(input.creator),
    normalize(input.body),
    normalize(input.positionStart),
    normalize(input.sourceScope)
  ].join("::");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function mergePassage(existing: Passage, next: Passage): Passage {
  return {
    ...existing,
    ...next,
    externalPassageId: next.externalPassageId ?? existing.externalPassageId,
    readerNote: next.readerNote ?? existing.readerNote,
    positionEnd: next.positionEnd ?? existing.positionEnd,
    markerColor: next.markerColor ?? existing.markerColor,
    labels: Array.from(new Set([...existing.labels, ...next.labels])),
    isStarred: existing.isStarred || next.isStarred,
    updatedAt: next.updatedAt
  };
}
