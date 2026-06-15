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
      className="ui-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="ui-card ui-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-prompt-heading"
      >
        <h2 id="support-prompt-heading" className="ui-card__title">
          Enjoying Archi?
        </h2>
        <div className="ui-card__body">
          <p>
            Archi is an independent project — no team, no investors, no ads. It's built and maintained one feature at a time,
            in service of a calmer reading library that stays yours.
          </p>
          <p>
            If it's earned a place in your day, you can chip in to keep new features shipping and the bugs at bay.
          </p>
        </div>
        <div className="ui-card__footer">
          <button type="button" className="ui-btn ui-btn--secondary" onClick={onClose}>
            Maybe later
          </button>
          <button type="button" className="ui-btn ui-btn--primary" onClick={handleBuy}>
            Buy me a coffee
          </button>
        </div>
      </div>
    </div>
  );
}
