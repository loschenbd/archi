export type ChatStatusBadgeProps = {
  modelName: string | null;
};

export function ChatStatusBadge({ modelName }: ChatStatusBadgeProps): JSX.Element {
  return (
    <span
      className="chat-status-badge"
      title="Your questions and your passages stay on this device. Nothing is sent over the network."
    >
      <span className="chat-status-dot" />
      Local · Ollama{modelName ? ` (${modelName})` : ""}
    </span>
  );
}
