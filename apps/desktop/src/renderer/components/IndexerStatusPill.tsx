import { useIndexerStatus } from "../state/IndexerStatusContext";

type Props = {
  collapsed: boolean;
};

export function IndexerStatusPill({ collapsed }: Props): JSX.Element | null {
  const { status, start, starting } = useIndexerStatus();

  if (!status) return null;

  if (status.status === "idle" && status.indexed >= status.total) {
    return null;
  }

  const tone =
    status.status === "failed" || status.status === "unavailable" ? "error" : "info";

  const dotChar =
    status.status === "running"
      ? "●"
      : status.status === "failed" || status.status === "unavailable"
        ? "⚠"
        : "○";

  let label: string;
  if (status.status === "unavailable") {
    label = "Search degraded";
  } else if (status.status === "failed") {
    label = "Indexing failed";
  } else if (status.status === "running") {
    label = `Indexing ${status.indexed.toLocaleString()} / ${status.total.toLocaleString()}`;
  } else {
    const pending = Math.max(0, status.total - status.indexed);
    label = `${pending.toLocaleString()} pending`;
  }

  const title =
    status.status === "failed" || status.status === "unavailable"
      ? (status.lastError ?? "Vector search unavailable. Keyword still works.")
      : label;

  const clickable = status.status === "idle" && status.indexed < status.total;

  const buttonLabel = starting ? "Starting…" : label;
  const inner = (
    <>
      <span className="indexer-status-pill__dot" aria-hidden="true">
        {dotChar}
      </span>
      {!collapsed && (
        <span className="indexer-status-pill__label">
          {clickable ? buttonLabel : label}
        </span>
      )}
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        className={`indexer-status-pill indexer-status-pill--${tone}`}
        onClick={() => void start()}
        disabled={starting}
        title={title}
        aria-label={buttonLabel}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      className={`indexer-status-pill indexer-status-pill--${tone}`}
      title={title}
      aria-live="polite"
      role="status"
    >
      {inner}
    </div>
  );
}
