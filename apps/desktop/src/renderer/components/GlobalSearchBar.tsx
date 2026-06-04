import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "@archi/search";
import { useIndexerStatus } from "../state/IndexerStatusContext";
import { HighlightedText } from "./HighlightedText";

type Props = {
  onEscalate: (query: string, expandPassageId?: string) => void;
};

export function GlobalSearchBar({ onEscalate }: Props): JSX.Element {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { status } = useIndexerStatus();

  // ⌘K focuses input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Outside-click closes dropdown
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // Debounced query
  useEffect(() => {
    if (!open || text.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await window.archi.search.query({ text, filters: {}, limit: 5 });
      setResults(res.results);
      setHighlighted(0);
    }, 150);
    return () => clearTimeout(handle);
  }, [text, open]);

  const escalate = useCallback(
    (expandPassageId?: string) => {
      const q = text;
      onEscalate(q, expandPassageId);
      setText("");
      setOpen(false);
      setResults([]);
    },
    [text, onEscalate]
  );

  const submit = useCallback(() => {
    const target = results[highlighted];
    if (target) {
      escalate(target.passageId);
    } else if (text.trim().length >= 2) {
      escalate();
    }
  }, [results, highlighted, escalate, text]);

  const showPartialLine =
    status !== null &&
    (status.status === "running" || (status.indexed < status.total && status.status === "idle"));

  const hasQuery = text.trim().length >= 2;
  const showEmpty = open && hasQuery && results.length === 0;

  return (
    <div className="global-search-bar" ref={containerRef}>
      <input
        ref={inputRef}
        className="global-search-bar__input"
        type="search"
        value={text}
        placeholder="Search highlights…"
        onFocus={() => setOpen(true)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, results.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(0, h - 1));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.metaKey || e.ctrlKey || results.length === 0) {
              escalate();
            } else {
              submit();
            }
          }
        }}
        aria-label="Global search"
      />
      <span className="global-search-bar__shortcut" aria-hidden="true">⌘K</span>
      {open && (results.length > 0 || showEmpty) && (
        <div className="global-search-bar__dropdown" role="listbox">
          {showPartialLine && (
            <div className="global-search-bar__partial-line" role="status">
              Results may be partial — {status!.indexed.toLocaleString()} / {status!.total.toLocaleString()} indexed
            </div>
          )}
          {results.map((r, i) => (
            <div
              key={r.passageId}
              role="option"
              aria-selected={i === highlighted}
              className={`global-search-bar__row ${i === highlighted ? "is-highlighted" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                escalate(r.passageId);
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <div className="global-search-bar__row-body">
                <HighlightedText snippet={r.snippet} />
              </div>
              <div className="global-search-bar__row-meta">
                {r.work.creator ? `${r.work.creator} · ` : ""}{r.work.displayTitle}
              </div>
            </div>
          ))}
          {showEmpty && (
            <button
              type="button"
              className="global-search-bar__empty-row"
              onMouseDown={(e) => {
                e.preventDefault();
                escalate();
              }}
            >
              No matches. Press <kbd>⌘↵</kbd> to open Search.
            </button>
          )}
          {results.length > 0 && (
            <button
              type="button"
              className="global-search-bar__see-all"
              onMouseDown={(e) => {
                e.preventDefault();
                escalate();
              }}
            >
              <span>See all results</span>
              <kbd>⌘↵</kbd>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
