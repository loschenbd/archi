type Props = {
  onFindSimilar: () => void;
};

export function FindSimilarButton({ onFindSimilar }: Props): JSX.Element {
  return (
    <button
      type="button"
      className="passage-card-action"
      onClick={(e) => {
        e.stopPropagation();
        onFindSimilar();
      }}
      aria-label="Find similar passages"
      title="Find passages semantically similar to this one"
    >
      <span className="passage-card-action-icon" aria-hidden="true">
        ⚡
      </span>
      Find similar
    </button>
  );
}
