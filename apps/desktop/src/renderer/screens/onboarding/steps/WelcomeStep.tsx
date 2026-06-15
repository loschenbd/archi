export function WelcomeStep(): JSX.Element {
  return (
    <div className="onboarding-wizard-step">
      <p className="content-eyebrow">Setup · Step 1 of 5</p>
      <h1 className="ui-card__title">Your library, finally searchable.</h1>
      <div className="ui-card__body">
        <p>
          Archi pulls in every Kindle highlight you&apos;ve ever made and keeps them on your Mac. Search across every
          book by phrase or by idea &mdash; and surface passages that connect to each other. Mirror the library to Notion if
          you want it there too. Takes a couple of minutes.
        </p>
      </div>
    </div>
  );
}
