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
          Hey — it's Ben.
        </h2>
        <p>
          I built Archi as a helpful little tool for my own use and I loved it. So I'm sharing it with you. I hope you find it
          useful too.
        </p>
        <p>
          If you'd like to support me in maintaining this app and making other useful things, you can buy me a coffee.
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
