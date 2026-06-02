type Props = {
  passageBody: string;
  onOpenSearchScreen: (initialQuery: string) => void;
};

export function FindSimilarButton({ passageBody, onOpenSearchScreen }: Props): JSX.Element {
  return (
    <button
      type="button"
      className="passage-card-action"
      onClick={(e) => {
        e.stopPropagation();
        // Cap query length to avoid awkward search-screen UX.
        const snippet = passageBody.slice(0, 240);
        onOpenSearchScreen(snippet);
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
