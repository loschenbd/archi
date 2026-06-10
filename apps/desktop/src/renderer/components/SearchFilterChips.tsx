import { useEffect, useRef, useState } from "react";
import type { SearchFilters } from "@archi/search";

type Props = {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
};

type LibraryWork = {
  id: string;
  title: string;
  creator?: string;
};

type Facets = { creators: string[]; labels: string[] };

const COLORS = ["yellow", "pink", "orange", "blue"] as const;

export function SearchFilterChips({ filters, onChange }: Props): JSX.Element {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [activeDimension, setActiveDimension] = useState<string | null>(null);
  const [facets, setFacets] = useState<Facets>({ creators: [], labels: [] });
  const [works, setWorks] = useState<LibraryWork[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.archi.search.facets().then(setFacets).catch(() => {});
    void window.archi.listWorks().then(setWorks).catch(() => {});
  }, []);

  useEffect(() => {
    if (!popoverOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) {
        setPopoverOpen(false);
        setActiveDimension(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPopoverOpen(false);
        setActiveDimension(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  const removeFilter = (key: keyof SearchFilters) => {
    const next = { ...filters };
    delete next[key];
    onChange(next);
  };

  const setCreator = (creator: string) => {
    onChange({ ...filters, creator });
    setPopoverOpen(false);
    setActiveDimension(null);
  };

  const setWorkId = (workId: string) => {
    onChange({ ...filters, workIds: [workId] });
    setPopoverOpen(false);
    setActiveDimension(null);
  };

  const setColor = (color: string) => {
    onChange({ ...filters, markerColor: color });
    setPopoverOpen(false);
    setActiveDimension(null);
  };

  const toggleLabel = (label: string) => {
    const current = filters.labels ?? [];
    const next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
    onChange(next.length > 0 ? { ...filters, labels: next } : { ...filters, labels: undefined });
  };

  const setDateRange = (markedAfter?: string, markedBefore?: string) => {
    const next: SearchFilters = { ...filters };
    if (markedAfter) next.markedAfter = markedAfter; else delete next.markedAfter;
    if (markedBefore) next.markedBefore = markedBefore; else delete next.markedBefore;
    onChange(next);
  };

  const activeWorkTitle = filters.workIds?.[0]
    ? works.find((w) => w.id === filters.workIds![0])?.title ?? filters.workIds[0]
    : null;
  const dateSummary =
    filters.markedAfter || filters.markedBefore
      ? `${filters.markedAfter ?? "…"} → ${filters.markedBefore ?? "…"}`
      : null;

  return (
    <div className="search-filter-chips" ref={popoverRef}>
      {filters.creator && (
        <span className="search-filter-chip">
          <span className="search-filter-chip__label">Author</span>
          <span className="search-filter-chip__value">{filters.creator}</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => removeFilter("creator")}
            aria-label="Remove author filter"
          >×</button>
        </span>
      )}
      {activeWorkTitle && (
        <span className="search-filter-chip">
          <span className="search-filter-chip__label">Book</span>
          <span className="search-filter-chip__value">{activeWorkTitle}</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => removeFilter("workIds")}
            aria-label="Remove book filter"
          >×</button>
        </span>
      )}
      {filters.isStarred && (
        <span className="search-filter-chip">
          <span className="search-filter-chip__label">Starred only</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => removeFilter("isStarred")}
            aria-label="Remove starred filter"
          >×</button>
        </span>
      )}
      {filters.markerColor && (
        <span className="search-filter-chip">
          <span className="search-filter-chip__label">Color</span>
          <span className="search-filter-chip__value">{filters.markerColor}</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => removeFilter("markerColor")}
            aria-label="Remove color filter"
          >×</button>
        </span>
      )}
      {(filters.labels ?? []).map((label) => (
        <span key={label} className="search-filter-chip">
          <span className="search-filter-chip__label">Label</span>
          <span className="search-filter-chip__value">{label}</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => toggleLabel(label)}
            aria-label={`Remove ${label} label filter`}
          >×</button>
        </span>
      ))}
      {dateSummary && (
        <span className="search-filter-chip">
          <span className="search-filter-chip__label">Date</span>
          <span className="search-filter-chip__value">{dateSummary}</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => setDateRange(undefined, undefined)}
            aria-label="Remove date filter"
          >×</button>
        </span>
      )}

      <button
        type="button"
        className="search-filter-chip search-filter-chip--add"
        onClick={() => setPopoverOpen((v) => !v)}
        aria-expanded={popoverOpen}
      >
        + Add filter
      </button>

      {popoverOpen && (
        <div className="search-filter-popover" role="menu">
          {activeDimension === null && (
            <>
              <button type="button" className="search-filter-popover__row" onClick={() => setActiveDimension("author")}>Author</button>
              <button type="button" className="search-filter-popover__row" onClick={() => setActiveDimension("book")}>Book</button>
              <button type="button" className="search-filter-popover__row" onClick={() => { onChange({ ...filters, isStarred: true }); setPopoverOpen(false); }}>Starred only</button>
              <button type="button" className="search-filter-popover__row" onClick={() => setActiveDimension("color")}>Marker color</button>
              <button type="button" className="search-filter-popover__row" onClick={() => setActiveDimension("label")}>Label</button>
              <button type="button" className="search-filter-popover__row" onClick={() => setActiveDimension("date")}>Date range</button>
            </>
          )}
          {activeDimension === "author" && (
            <div className="search-filter-popover__panel">
              {facets.creators.length === 0 && <p>No authors yet.</p>}
              {facets.creators.map((c) => (
                <button key={c} type="button" className="search-filter-popover__row" onClick={() => setCreator(c)}>{c}</button>
              ))}
            </div>
          )}
          {activeDimension === "book" && (
            <div className="search-filter-popover__panel">
              {works.length === 0 && <p>No books yet.</p>}
              {works.map((w) => (
                <button key={w.id} type="button" className="search-filter-popover__row" onClick={() => setWorkId(w.id)}>
                  {w.title}{w.creator ? ` · ${w.creator}` : ""}
                </button>
              ))}
            </div>
          )}
          {activeDimension === "color" && (
            <div className="search-filter-popover__panel">
              {COLORS.map((c) => (
                <button key={c} type="button" className="search-filter-popover__row" onClick={() => setColor(c)}>{c}</button>
              ))}
            </div>
          )}
          {activeDimension === "label" && (
            <div className="search-filter-popover__panel">
              {facets.labels.length === 0 && <p>No labels in your highlights yet.</p>}
              {facets.labels.map((l) => {
                const active = (filters.labels ?? []).includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    className={`search-filter-popover__row${active ? " is-active" : ""}`}
                    onClick={() => toggleLabel(l)}
                  >
                    {active ? "✓ " : ""}{l}
                  </button>
                );
              })}
            </div>
          )}
          {activeDimension === "date" && (
            <div className="search-filter-popover__panel search-filter-popover__panel--date">
              <label>
                From
                <input
                  type="date"
                  value={filters.markedAfter ?? ""}
                  onChange={(e) => setDateRange(e.target.value || undefined, filters.markedBefore)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={filters.markedBefore ?? ""}
                  onChange={(e) => setDateRange(filters.markedAfter, e.target.value || undefined)}
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
