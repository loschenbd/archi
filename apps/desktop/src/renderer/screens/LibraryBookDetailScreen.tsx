import { useEffect, useMemo, useRef, useState } from "react";
import { FindSimilarButton } from "../components/FindSimilarButton";

type PositionKind = "page" | "location" | "offset" | "order" | "unknown";

type LibraryWork = {
  id: string;
  title: string;
  creator?: string;
  externalId?: string;
  storeIdentifier?: string;
};

type LibraryPassage = {
  id: string;
  body: string;
  readerNote?: string;
  externalPassageId?: string;
  positionKind?: PositionKind;
  positionStart?: string;
  positionEnd?: string;
  markedAt?: string;
  updatedAt: string;
};

type LocationGroup = {
  id: string;
  label: string;
  kindOrder: number;
  numericOrder: number;
  lexicalOrder: string;
  passages: LibraryPassage[];
};

type Props = {
  work: LibraryWork;
  onOpenSearchScreen: (initialQuery: string) => void;
  pendingScrollPassageId?: string | null;
  breadcrumbFromSearch?: boolean;
  onBackToSearch?: () => void;
};

function parseNumber(text?: string): number {
  if (!text) {
    return Number.POSITIVE_INFINITY;
  }
  const numeric = Number(text.replaceAll(",", ""));
  return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
}

function formatLocationLabel(kind?: PositionKind, start?: string, end?: string): string {
  if (!start) {
    return "Unknown location";
  }
  const normalizedKind = kind && kind !== "unknown" ? kind : "location";
  const base = `${normalizedKind[0]?.toUpperCase() ?? ""}${normalizedKind.slice(1)} ${start}`;
  return end && end !== start ? `${base}-${end}` : base;
}

function formatShortLocation(kind?: PositionKind, start?: string, end?: string): string {
  if (!start) {
    return "Unknown location";
  }
  const normalizedKind = kind && kind !== "unknown" ? kind : "location";
  const prefix =
    normalizedKind === "location"
      ? "Loc."
      : normalizedKind === "page"
        ? "Page"
        : normalizedKind === "offset"
          ? "Offset"
          : normalizedKind === "order"
            ? "#"
            : "Loc.";
  const base = `${prefix} ${start}`;
  return end && end !== start ? `${base}–${end}` : base;
}

function getKindOrder(kind?: PositionKind): number {
  switch (kind) {
    case "location":
      return 0;
    case "page":
      return 1;
    case "offset":
      return 2;
    case "order":
      return 3;
    default:
      return 4;
  }
}

function groupPassages(passages: LibraryPassage[]): LocationGroup[] {
  const grouped = new Map<string, LocationGroup>();
  for (const passage of passages) {
    const groupKey = `${passage.positionKind ?? "unknown"}:${passage.positionStart ?? ""}:${passage.positionEnd ?? ""}`;
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.passages.push(passage);
      continue;
    }
    grouped.set(groupKey, {
      id: groupKey,
      label: formatLocationLabel(passage.positionKind, passage.positionStart, passage.positionEnd),
      kindOrder: getKindOrder(passage.positionKind),
      numericOrder: parseNumber(passage.positionStart),
      lexicalOrder: `${passage.positionKind ?? "unknown"}:${passage.positionStart ?? ""}`.toLowerCase(),
      passages: [passage]
    });
  }
  return [...grouped.values()]
    .map((group) => ({
      ...group,
      passages: [...group.passages].sort((a, b) => (a.markedAt ?? a.updatedAt < (b.markedAt ?? b.updatedAt) ? 1 : -1))
    }))
    .sort((a, b) => {
      if (a.kindOrder !== b.kindOrder) {
        return a.kindOrder - b.kindOrder;
      }
      if (a.numericOrder !== b.numericOrder) {
        return a.numericOrder - b.numericOrder;
      }
      return a.lexicalOrder.localeCompare(b.lexicalOrder);
    });
}

function inferAsin(work: LibraryWork): string | undefined {
  const candidates = [work.storeIdentifier, work.externalId];
  for (const value of candidates) {
    if (!value) {
      continue;
    }
    const match = /([A-Z0-9]{10})/i.exec(value);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }
  return undefined;
}

function toRawHighlightId(externalPassageId?: string): string | undefined {
  if (!externalPassageId) {
    return undefined;
  }
  const separator = "::";
  const separatorIndex = externalPassageId.lastIndexOf(separator);
  if (separatorIndex === -1) {
    return externalPassageId;
  }
  const raw = externalPassageId.slice(separatorIndex + separator.length).trim();
  return raw || externalPassageId;
}

function createNotebookFallbackUrl(baseUrl: string, work: LibraryWork, passage: LibraryPassage, asin?: string): string {
  try {
    const url = new URL(baseUrl);
    if (asin) {
      url.searchParams.set("asin", asin);
    } else {
      url.searchParams.set("query", work.title);
    }
    if (passage.positionStart) {
      url.searchParams.set("location", passage.positionStart);
    }
    const rawHighlightId = toRawHighlightId(passage.externalPassageId);
    if (rawHighlightId) {
      url.searchParams.set("highlight", rawHighlightId);
    } else {
      url.searchParams.set("highlightQuery", passage.body.slice(0, 120));
    }
    return url.toString();
  } catch {
    return "https://read.amazon.com/notebook";
  }
}

export function LibraryBookDetailScreen({ work, onOpenSearchScreen, pendingScrollPassageId, breadcrumbFromSearch: _breadcrumbFromSearch, onBackToSearch: _onBackToSearch }: Props): JSX.Element {
  const [passages, setPassages] = useState<LibraryPassage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [kindleErrorMessage, setKindleErrorMessage] = useState<string | null>(null);
  const [openingPassageId, setOpeningPassageId] = useState<string | null>(null);
  const [copiedPassageId, setCopiedPassageId] = useState<string | null>(null);
  const [notebookUrl, setNotebookUrl] = useState("https://read.amazon.com/notebook");

  useEffect(() => {
    let canceled = false;
    setIsLoading(true);
    setErrorMessage(null);
    void window.archi
      .listPassagesByWork(work.id)
      .then((result) => {
        if (!canceled) {
          setPassages(result);
        }
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load passages.");
        }
      })
      .finally(() => {
        if (!canceled) {
          setIsLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [work.id]);

  useEffect(() => {
    let canceled = false;
    void window.archi.getSettings().then((settings) => {
      if (!canceled) {
        setNotebookUrl(settings.cloudNotebookUrl);
      }
    });
    return () => {
      canceled = true;
    };
  }, []);

  const ringRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const [ringed, setRinged] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingScrollPassageId) return;
    if (!passages.some((p) => p.id === pendingScrollPassageId)) return;
    const node = ringRefs.current[pendingScrollPassageId];
    if (!node) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    setRinged(pendingScrollPassageId);
    const timer = window.setTimeout(() => setRinged(null), 1500);
    return () => window.clearTimeout(timer);
  }, [pendingScrollPassageId, passages]);

  const groups = useMemo(() => groupPassages(passages), [passages]);
  const sortedPassages = useMemo(
    () =>
      groups.flatMap((group) =>
        group.passages.map((passage) => ({
          passage,
          locationLabel: formatShortLocation(passage.positionKind, passage.positionStart, passage.positionEnd)
        }))
      ),
    [groups]
  );

  const copyPassage = async (passage: LibraryPassage): Promise<void> => {
    try {
      await navigator.clipboard.writeText(passage.body);
      setCopiedPassageId(passage.id);
      window.setTimeout(() => {
        setCopiedPassageId((current) => (current === passage.id ? null : current));
      }, 1400);
    } catch {
      // Clipboard write can reject in unusual sandbox states; silently swallow.
    }
  };

  const handleOpenInKindle = async (passage: LibraryPassage): Promise<void> => {
    setOpeningPassageId(passage.id);
    setKindleErrorMessage(null);
    const asin = inferAsin(work);
    const locationNumber = parseNumber(passage.positionStart);
    const urls: string[] = [];
    if (asin && Number.isFinite(locationNumber)) {
      urls.push(`kindle://book?action=open&asin=${encodeURIComponent(asin)}&location=${encodeURIComponent(passage.positionStart ?? "")}`);
      urls.push(`kindle://book?action=open&asin=${encodeURIComponent(asin)}&position=${encodeURIComponent(passage.positionStart ?? "")}`);
    }
    const rawHighlightId = toRawHighlightId(passage.externalPassageId);
    if (rawHighlightId) {
      urls.push(`kindle://highlight?action=open&asin=${encodeURIComponent(asin ?? "")}&highlight=${encodeURIComponent(rawHighlightId)}`);
    }
    urls.push(createNotebookFallbackUrl(notebookUrl, work, passage, asin));
    for (const url of urls) {
      const result = await window.archi.openExternalUrl(url);
      if (result.opened) {
        setOpeningPassageId(null);
        return;
      }
    }
    setKindleErrorMessage("Could not open this specific quote in Kindle. Try reconnecting cloud notebook and retry.");
    setOpeningPassageId(null);
  };

  return (
    <section className="library-detail-screen">
      {isLoading ? <p>Loading quotes...</p> : null}
      {errorMessage ? <p className="error">{errorMessage}</p> : null}
      {kindleErrorMessage ? <p className="error">{kindleErrorMessage}</p> : null}
      {!isLoading && !errorMessage && sortedPassages.length === 0 ? <p>No quotes found for this work yet.</p> : null}
      <ul className="library-quotes">
        {sortedPassages.map(({ passage, locationLabel }) => (
          <li
            key={passage.id}
            className={`library-quote-card${ringed === passage.id ? " library-quote-card--ringed" : ""}`}
            ref={(node) => {
              ringRefs.current[passage.id] = node;
            }}
          >
            <p className="library-quote-body">{passage.body}</p>
            {passage.readerNote ? <p className="library-quote-note">Note: {passage.readerNote}</p> : null}
            <footer className="library-quote-footer">
              <span className="library-quote-location">{locationLabel}</span>
              <span className="library-quote-separator" aria-hidden="true">·</span>
              <button
                type="button"
                className="library-quote-open"
                onClick={() => void handleOpenInKindle(passage)}
                disabled={openingPassageId === passage.id}
              >
                {openingPassageId === passage.id ? "Opening…" : "↗ Open in Kindle"}
              </button>
              <FindSimilarButton
                passageBody={passage.body}
                onOpenSearchScreen={onOpenSearchScreen}
              />
              <button
                type="button"
                className={`passage-card-action ${
                  copiedPassageId === passage.id ? "passage-card-action-success" : ""
                }`}
                onClick={() => {
                  void copyPassage(passage);
                }}
                title="Copy quote to clipboard"
              >
                <span className="passage-card-action-icon" aria-hidden="true">
                  {copiedPassageId === passage.id ? "✓" : "⎘"}
                </span>
                {copiedPassageId === passage.id ? "Copied" : "Copy"}
              </button>
            </footer>
          </li>
        ))}
      </ul>
    </section>
  );
}
