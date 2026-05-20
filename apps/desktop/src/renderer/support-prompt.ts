export type SupportPromptTrigger = {
  phase: string;
  status: string;
  counts?: { passages?: number } | undefined;
};

export function shouldShowSupportPrompt(event: SupportPromptTrigger, promptShown: boolean): boolean {
  if (promptShown) {
    return false;
  }
  if (event.phase !== "sync_complete") {
    return false;
  }
  if (event.status !== "success" && event.status !== "partial_success") {
    return false;
  }
  if ((event.counts?.passages ?? 0) <= 0) {
    return false;
  }
  return true;
}
