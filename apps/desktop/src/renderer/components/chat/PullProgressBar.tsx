import type { PullProgress } from "@archi/chat";

export type PullProgressBarProps = {
  progress: PullProgress | null;
};

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return "—";
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / 1_000_000;
  return `${mb.toFixed(1)} MB`;
}

export function PullProgressBar({ progress }: PullProgressBarProps): JSX.Element {
  if (!progress) return <></>;
  if (progress.error) {
    return <div className="chat-pull-error">Pull failed: {progress.error}</div>;
  }
  const pct =
    progress.completed !== undefined && progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : null;
  return (
    <div className="chat-pull">
      <div className="chat-pull-status">
        {progress.status}
        {progress.done ? " — done" : ""}
      </div>
      <div className="chat-pull-bar">
        <div
          className="chat-pull-bar-fill"
          style={{ width: pct === null ? "0%" : `${pct}%` }}
        />
      </div>
      <div className="chat-pull-byline">
        {formatBytes(progress.completed)} / {formatBytes(progress.total)}
      </div>
    </div>
  );
}
