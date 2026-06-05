import { useIndexerStatus } from "../state/IndexerStatusContext";
import { useSearchPreferences } from "../state/SearchPreferencesContext";

// Mirrors @archi/search's EMBEDDING_MODEL_ID. Cannot import from @archi/search:
// its barrel pulls embedding/modelPaths.ts which imports node:fs, and Vite
// stubs node:fs in the renderer bundle (throws at module load).
const EMBEDDING_MODEL_ID = "bge-small-en-v1.5@v1";

function Toggle({
  checked,
  onChange,
  ariaLabel
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`settings-toggle${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle__thumb" />
    </button>
  );
}

function SettingsRow({
  label,
  description,
  control
}: {
  label: string;
  description: string;
  control: JSX.Element;
}): JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <div className="settings-row__label">{label}</div>
        <div className="settings-row__description">{description}</div>
      </div>
      <div className="settings-row__control">{control}</div>
    </div>
  );
}

export function SettingsScreen(): JSX.Element {
  const prefs = useSearchPreferences();
  const { status } = useIndexerStatus();

  return (
    <section className="settings-screen">
      <header className="settings-screen__section-header">
        <h2>Search</h2>
      </header>
      <SettingsRow
        label="Show match-source labels"
        description="Show whether each result matched by meaning, keyword, or both."
        control={
          <Toggle
            checked={prefs.showMatchSource}
            onChange={prefs.setShowMatchSource}
            ariaLabel="Show match-source labels"
          />
        }
      />
      <SettingsRow
        label="Include archived passages"
        description="Off by default. Turning this on adds archived highlights to all search results."
        control={
          <Toggle
            checked={prefs.includeArchived}
            onChange={prefs.setIncludeArchived}
            ariaLabel="Include archived passages"
          />
        }
      />
      <SettingsRow
        label="Include hidden passages"
        description="Off by default."
        control={
          <Toggle
            checked={prefs.includeHidden}
            onChange={prefs.setIncludeHidden}
            ariaLabel="Include hidden passages"
          />
        }
      />
      <hr className="settings-screen__divider" />
      <div className="settings-screen__index-status">
        <div className="settings-row__label">Index status</div>
        <div className="settings-row__description">
          {status
            ? `${status.indexed.toLocaleString()} / ${status.total.toLocaleString()} indexed`
            : "Loading…"}
          {" · "}
          <code>{EMBEDDING_MODEL_ID}</code>
        </div>
      </div>
    </section>
  );
}
