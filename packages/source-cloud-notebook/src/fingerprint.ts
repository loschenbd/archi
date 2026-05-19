import { createHash } from "node:crypto";

export const FINGERPRINT_VERSION = "v1";
export const FINGERPRINT_FIRST_ID_LIMIT = 8;
export const FINGERPRINT_HASH_PREFIX_LENGTH = 16;

export type BookFingerprintInput = {
  visibleAnnotationCount: number;
  firstAnnotationIds: string[];
};

export function computeBookFingerprint(input: BookFingerprintInput): string {
  const ids = input.firstAnnotationIds.slice(0, FINGERPRINT_FIRST_ID_LIMIT);
  const payload = `${input.visibleAnnotationCount}${ids.join("")}`;
  const digest = createHash("sha256").update(payload).digest("hex").slice(0, FINGERPRINT_HASH_PREFIX_LENGTH);
  return `${FINGERPRINT_VERSION}:${input.visibleAnnotationCount}:${digest}`;
}

export type BookDecision =
  | { kind: "skip"; reason: "fingerprint-match" }
  | { kind: "extract"; reason: "no-prior" | "count-differs" | "ids-differ" | "prefix-mismatch" | "forced" };

export function decideBookAction(args: {
  prior: string | undefined;
  peeked: string;
  forceFullSweep: boolean;
}): BookDecision {
  if (args.forceFullSweep) {
    return { kind: "extract", reason: "forced" };
  }
  if (args.prior === undefined) {
    return { kind: "extract", reason: "no-prior" };
  }
  if (args.prior === args.peeked) {
    return { kind: "skip", reason: "fingerprint-match" };
  }
  const priorParts = args.prior.split(":");
  const peekedParts = args.peeked.split(":");
  if (priorParts[0] !== peekedParts[0]) {
    return { kind: "extract", reason: "prefix-mismatch" };
  }
  if (priorParts[1] !== peekedParts[1]) {
    return { kind: "extract", reason: "count-differs" };
  }
  return { kind: "extract", reason: "ids-differ" };
}

export type BookOutcome =
  | { bookId: string; outcome: "select-failed" }
  | { bookId: string; outcome: "peek-failed-extracted" }
  | { bookId: string; outcome: "extract-failed"; fingerprint: string }
  | { bookId: string; outcome: "skipped"; fingerprint: string }
  | { bookId: string; outcome: "extracted"; fingerprint: string };

export function summarizeBookOutcomes(outcomes: BookOutcome[]): {
  sidebarBookIds: string[];
  fetchedBookIds: string[];
  skippedByFingerprintBookIds: string[];
  fingerprints: Map<string, string>;
  selectFailedBookIds: string[];
} {
  const sidebarBookIds: string[] = [];
  const fetchedBookIds: string[] = [];
  const skippedByFingerprintBookIds: string[] = [];
  const selectFailedBookIds: string[] = [];
  const fingerprints = new Map<string, string>();
  for (const o of outcomes) {
    sidebarBookIds.push(o.bookId);
    switch (o.outcome) {
      case "select-failed":
        selectFailedBookIds.push(o.bookId);
        break;
      case "peek-failed-extracted":
        fetchedBookIds.push(o.bookId);
        break;
      case "extract-failed":
        break;
      case "skipped":
        skippedByFingerprintBookIds.push(o.bookId);
        fingerprints.set(o.bookId, o.fingerprint);
        break;
      case "extracted":
        fetchedBookIds.push(o.bookId);
        fingerprints.set(o.bookId, o.fingerprint);
        break;
    }
  }
  return { sidebarBookIds, fetchedBookIds, skippedByFingerprintBookIds, fingerprints, selectFailedBookIds };
}
