import { useState } from "react";
import type { SearchFilters } from "@archi/search";

type Props = {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  availableCreators: string[];
};

export function SearchFilterChips({ filters, onChange, availableCreators }: Props) {
  const [addingDim, setAddingDim] = useState<string | null>(null);

  const removeFilter = (key: keyof SearchFilters) => {
    const next = { ...filters };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="search-filter-chips">
      {filters.creator && (
        <span className="search-filter-chip">
          Author: {filters.creator}
          <button type="button" onClick={() => removeFilter("creator")} aria-label="Remove author filter">✕</button>
        </span>
      )}
      {filters.isStarred && (
        <span className="search-filter-chip">
          ★ Starred only
          <button type="button" onClick={() => removeFilter("isStarred")} aria-label="Remove starred filter">✕</button>
        </span>
      )}
      {filters.markerColor && (
        <span className="search-filter-chip">
          Color: {filters.markerColor}
          <button type="button" onClick={() => removeFilter("markerColor")} aria-label="Remove color filter">✕</button>
        </span>
      )}

      {addingDim === null ? (
        <button type="button" className="search-filter-chip search-filter-chip--add" onClick={() => setAddingDim("menu")}>
          + Add filter
        </button>
      ) : (
        <div className="search-filter-chip-menu">
          <button type="button" onClick={() => { setAddingDim("creator"); }}>Author</button>
          <button type="button" onClick={() => { onChange({ ...filters, isStarred: true }); setAddingDim(null); }}>Starred</button>
          <button type="button" onClick={() => setAddingDim("color")}>Color</button>
          <button type="button" onClick={() => setAddingDim(null)}>Cancel</button>
        </div>
      )}

      {addingDim === "creator" && (
        <select
          autoFocus
          onChange={(e) => { onChange({ ...filters, creator: e.target.value }); setAddingDim(null); }}
          onBlur={() => setAddingDim(null)}
          defaultValue=""
        >
          <option value="" disabled>Choose author…</option>
          {availableCreators.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      )}

      {addingDim === "color" && (
        <select
          autoFocus
          onChange={(e) => { onChange({ ...filters, markerColor: e.target.value }); setAddingDim(null); }}
          onBlur={() => setAddingDim(null)}
          defaultValue=""
        >
          <option value="" disabled>Choose color…</option>
          <option value="yellow">Yellow</option>
          <option value="pink">Pink</option>
          <option value="orange">Orange</option>
          <option value="blue">Blue</option>
        </select>
      )}
    </div>
  );
}
