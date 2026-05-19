import type { NotionWorkInput } from "./index.js";

export type DesiredIcon =
  | { type: "external_url"; url: string }
  | { type: "emoji"; emoji: string };

export type DesiredMedia = {
  icon: DesiredIcon;
  coverUrl?: string;
};

const EMOJI_BY_TYPE: Record<string, string> = {
  book: "📚",
  article: "📰",
  periodical: "🗞️",
  document: "📄",
  other: "📌"
};

export function emojiFor(workType: string): string {
  return EMOJI_BY_TYPE[workType] ?? "📌";
}

export function chooseMedia(work: Pick<NotionWorkInput, "workType" | "coverImageUrl">): DesiredMedia {
  const url = work.coverImageUrl?.trim();
  if (url) {
    return {
      icon: { type: "external_url", url },
      coverUrl: url
    };
  }
  return {
    icon: { type: "emoji", emoji: emojiFor(work.workType) },
    coverUrl: undefined
  };
}
