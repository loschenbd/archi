export type ChatHistoryDeleteModalProps = {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ChatHistoryDeleteModal(props: ChatHistoryDeleteModalProps): JSX.Element {
  const { title, onCancel, onConfirm } = props;
  return (
    <div className="ui-modal-backdrop" onClick={onCancel}>
      <div
        className="ui-card ui-modal-card chat-history-delete-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="ui-card__title">Delete this conversation?</h2>
        <p className="chat-history-delete-modal-body">
          "{title}" will be permanently removed. This can't be undone.
        </p>
        <div className="chat-history-delete-modal-actions">
          <button type="button" className="ui-btn ui-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ui-btn ui-btn--danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
