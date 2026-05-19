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

export type MediaNotionClient = {
  pages: {
    retrieve: (args: { page_id: string }) => Promise<unknown>;
    update: (args: { page_id: string; icon?: unknown; cover?: unknown }) => Promise<unknown>;
  };
};

export type ApplyPageMediaOptions = {
  force: boolean;
  isNewPage: boolean;
};

type CurrentIcon =
  | { kind: "external"; url: string }
  | { kind: "emoji"; emoji: string }
  | null;

type CurrentCover = { url: string } | null;

type NotionIconShape =
  | { type: "external"; external: { url: string } }
  | { type: "emoji"; emoji: string }
  | null
  | undefined;

type NotionCoverShape =
  | { type: "external"; external: { url: string } }
  | null
  | undefined;

function normalizeCurrentIcon(icon: NotionIconShape): CurrentIcon {
  if (!icon) return null;
  if (icon.type === "external") return { kind: "external", url: icon.external.url };
  if (icon.type === "emoji") return { kind: "emoji", emoji: icon.emoji };
  return null;
}

function normalizeCurrentCover(cover: NotionCoverShape): CurrentCover {
  if (!cover) return null;
  if (cover.type === "external") return { url: cover.external.url };
  return null;
}

function iconShape(desired: DesiredIcon): { type: "external"; external: { url: string } } | { type: "emoji"; emoji: string } {
  if (desired.type === "external_url") {
    return { type: "external", external: { url: desired.url } };
  }
  return { type: "emoji", emoji: desired.emoji };
}

function coverShape(url: string): { type: "external"; external: { url: string } } {
  return { type: "external", external: { url } };
}

function iconMatches(current: CurrentIcon, desired: DesiredIcon): boolean {
  if (!current) return false;
  if (desired.type === "external_url") {
    return current.kind === "external" && current.url === desired.url;
  }
  return current.kind === "emoji" && current.emoji === desired.emoji;
}

function coverMatches(current: CurrentCover, desiredUrl: string | undefined): boolean {
  if (!desiredUrl) return current === null;
  return current !== null && current.url === desiredUrl;
}

export async function applyPageMedia(
  client: MediaNotionClient,
  pageId: string,
  desired: DesiredMedia,
  opts: ApplyPageMediaOptions
): Promise<void> {
  if (opts.isNewPage) {
    const body: { page_id: string; icon?: unknown; cover?: unknown } = {
      page_id: pageId,
      icon: iconShape(desired.icon)
    };
    if (desired.coverUrl) {
      body.cover = coverShape(desired.coverUrl);
    }
    await client.pages.update(body);
    return;
  }

  const page = (await client.pages.retrieve({ page_id: pageId })) as {
    icon?: NotionIconShape;
    cover?: NotionCoverShape;
  };
  const currentIcon = normalizeCurrentIcon(page.icon);
  const currentCover = normalizeCurrentCover(page.cover);

  const iconChanged = opts.force || !iconMatches(currentIcon, desired.icon);
  const coverChanged = opts.force || !coverMatches(currentCover, desired.coverUrl);

  if (!iconChanged && !coverChanged) {
    return;
  }

  const body: { page_id: string; icon?: unknown; cover?: unknown } = { page_id: pageId };
  if (iconChanged) {
    body.icon = iconShape(desired.icon);
  }
  if (coverChanged) {
    // Spec: do not clear an existing cover on normal syncs when our URL disappears.
    if (!desired.coverUrl && !opts.force) {
      // skip cover patch
    } else {
      body.cover = desired.coverUrl ? coverShape(desired.coverUrl) : null;
    }
  }

  if (body.icon === undefined && body.cover === undefined) {
    return;
  }

  await client.pages.update(body);
}

const URL_REJECTION_PATTERN = /invalid image url|url is not a valid url|image is too large|unsupported image|external url is invalid|could not download/i;

export function isMediaUrlRejection(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as Error & { code?: string }).code;
  if (code !== "validation_error") {
    return false;
  }
  return URL_REJECTION_PATTERN.test(error.message);
}
