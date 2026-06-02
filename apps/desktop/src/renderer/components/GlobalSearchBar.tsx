import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "@archi/search";

type Props = {
  onOpenPassage: (passageId: string) => void;
  onOpenSearchScreen: (initialQuery: string) => void;
};

export function GlobalSearchBar({ onOpenPassage, onOpenSearchScreen }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const submit = useCallback(() => {
    const target = results[highlighted];
    if (target) {
      onOpenPassage(target.passageId);
      setOpen(false);
    }
  }, [results, highlighted, onOpenPassage]);

  const escalate = useCallback(() => {
    onOpenSearchScreen(text);
    setOpen(false);
  }, [text, onOpenSearchScreen]);

  return (
    <div className="global-search-bar">
      <input
        ref={inputRef}
        className="global-search-bar__input"
        type="search"
        value={text}
        placeholder="Search highlights…"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(0, h - 1)); }
          if (e.key === "Enter") {
            if (e.metaKey || e.ctrlKey) { escalate(); } else { submit(); }
          }
        }}
        aria-label="Global search"
      />
      <span className="global-search-bar__shortcut" aria-hidden="true">⌘K</span>
      {open && results.length > 0 && (
        <div className="global-search-bar__dropdown" role="listbox">
          {results.map((r, i) => (
            <div
              key={r.passageId}
              role="option"
              aria-selected={i === highlighted}
              className={`global-search-bar__row ${i === highlighted ? "is-highlighted" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); onOpenPassage(r.passageId); setOpen(false); }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <div className="global-search-bar__row-body">{r.snippet}</div>
              <div className="global-search-bar__row-meta">
                {r.work.creator ? `${r.work.creator} · ` : ""}{r.work.displayTitle}
              </div>
            </div>
          ))}
          <button type="button" className="global-search-bar__see-all" onMouseDown={(e) => { e.preventDefault(); escalate(); }}>
            <span>See all results</span>
            <kbd>⌘↵</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
