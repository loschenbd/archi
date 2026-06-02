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
          <span className="search-filter-chip__label">Author</span>
          <span className="search-filter-chip__value">{filters.creator}</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => removeFilter("creator")}
            aria-label="Remove author filter"
          >
            ×
          </button>
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
          >
            ×
          </button>
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
          >
            ×
          </button>
        </span>
      )}

      {addingDim === null ? (
        <button
          type="button"
          className="search-filter-chip search-filter-chip--add"
          onClick={() => setAddingDim("menu")}
        >
          + Add filter
        </button>
      ) : addingDim === "menu" ? (
        <div className="search-filter-chip-menu" role="menu">
          <button type="button" onClick={() => setAddingDim("creator")}>
            Author
          </button>
          <button
            type="button"
            onClick={() => {
              onChange({ ...filters, isStarred: true });
              setAddingDim(null);
            }}
          >
            Starred
          </button>
          <button type="button" onClick={() => setAddingDim("color")}>
            Color
          </button>
          <button type="button" onClick={() => setAddingDim(null)}>
            Cancel
          </button>
        </div>
      ) : null}

      {addingDim === "creator" && (
        <select
          autoFocus
          onChange={(e) => {
            onChange({ ...filters, creator: e.target.value });
            setAddingDim(null);
          }}
          onBlur={() => setAddingDim(null)}
          defaultValue=""
        >
          <option value="" disabled>
            Choose author…
          </option>
          {availableCreators.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}

      {addingDim === "color" && (
        <select
          autoFocus
          onChange={(e) => {
            onChange({ ...filters, markerColor: e.target.value });
            setAddingDim(null);
          }}
          onBlur={() => setAddingDim(null)}
          defaultValue=""
        >
          <option value="" disabled>
            Choose color…
          </option>
          <option value="yellow">Yellow</option>
          <option value="pink">Pink</option>
          <option value="orange">Orange</option>
          <option value="blue">Blue</option>
        </select>
      )}
    </div>
  );
}
