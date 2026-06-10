import { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SupportPromptModal({ open, onClose }: Props): JSX.Element | null {
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const handleBuy = (): void => {
    void window.archi.openSupportLink();
    onClose();
  };

  return (
    <div
      className="support-prompt-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="support-prompt-modal" role="dialog" aria-modal="true" aria-labelledby="support-prompt-heading">
        <h2 id="support-prompt-heading" className="support-prompt-heading">
          Enjoying Archi?
        </h2>
        <p>
          Archi is an independent project — no team, no investors, no ads. It's built and maintained one feature at a time,
          in service of a calmer reading library that stays yours.
        </p>
        <p>
          If it's earned a place in your day, you can chip in to keep new features shipping and the bugs at bay.
        </p>
        <div className="support-prompt-actions">
          <button type="button" className="support-prompt-primary" onClick={handleBuy}>
            Buy me a coffee
          </button>
          <button type="button" className="support-prompt-secondary" onClick={onClose}>
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
