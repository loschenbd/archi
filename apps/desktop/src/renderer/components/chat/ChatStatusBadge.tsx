export type ChatStatusBadgeProps = {
  modelName: string | null;
};

export function ChatStatusBadge({ modelName }: ChatStatusBadgeProps): JSX.Element {
  return (
    <span
      className="ui-badge ui-badge--info"
      title="Your questions and your passages stay on this device. Nothing is sent over the network."
    >
      <span className="ui-badge__dot" />
      Local · Ollama{modelName ? ` (${modelName})` : ""}
    </span>
  );
}
