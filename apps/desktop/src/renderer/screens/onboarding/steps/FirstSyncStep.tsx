type Props = {
  isCompleting: boolean;
  hasError: boolean;
};

export function FirstSyncStep({ isCompleting, hasError }: Props): JSX.Element {
  return (
    <div className="onboarding-wizard-step">
      <p className="content-eyebrow">Step 5 of 5 · Importing</p>
      <h1>Importing your library…</h1>
      <p>
        {hasError
          ? "Something went wrong saving your setup. Try again to continue."
          : isCompleting
            ? "Pulling in your highlights and indexing them for search. You can keep using Archi while this runs."
            : "Almost there."}
      </p>
    </div>
  );
}
