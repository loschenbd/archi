import type { SyncJob, SyncJobStatus } from "../types.js";

const terminalStatuses: SyncJobStatus[] = ["success", "partial_success", "failed", "needs_auth"];

export function startSyncAttempt(job: SyncJob, now = new Date().toISOString()): SyncJob {
  return {
    ...job,
    status: "running",
    lastAttemptAt: now,
    lastError: undefined
  };
}

export function finishSyncAttempt(
  job: SyncJob,
  params: {
    status: Exclude<SyncJobStatus, "running" | "idle">;
    resumeCursor?: string;
    changedAfter?: string;
    error?: string;
    now?: string;
  }
): SyncJob {
  if (!terminalStatuses.includes(params.status)) {
    throw new Error(`Invalid sync terminal state: ${params.status}`);
  }

  const now = params.now ?? new Date().toISOString();

  return {
    ...job,
    status: params.status,
    resumeCursor: params.resumeCursor ?? job.resumeCursor,
    changedAfter: params.changedAfter ?? job.changedAfter,
    lastSuccessAt: params.status === "success" ? now : job.lastSuccessAt,
    lastAttemptAt: now,
    lastError: params.error
  };
}
