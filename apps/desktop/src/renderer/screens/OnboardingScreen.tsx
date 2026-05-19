type Props = {
  isCompleting: boolean;
  onContinue: () => void;
};

export function OnboardingScreen({ isCompleting, onContinue }: Props): JSX.Element {
  return (
    <section className="onboarding-screen">
      <p className="content-eyebrow">Welcome</p>
      <h1>Set up Archi</h1>
      <p>
        This quick onboarding gets your workspace ready before background sync starts. You can connect Kindle and Notion in the
        next step.
      </p>
      <div className="onboarding-actions">
        <button className="button-primary" onClick={onContinue} disabled={isCompleting}>
          {isCompleting ? "Preparing workspace..." : "Start setup"}
        </button>
      </div>
    </section>
  );
}
