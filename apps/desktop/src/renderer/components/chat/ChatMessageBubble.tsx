import type { ReactNode } from "react";

export type ChatBubbleRole = "user" | "assistant";

export type ChatMessageBubbleProps = {
  role: ChatBubbleRole;
  text: ReactNode;
  footer?: ReactNode;
  ghosted?: boolean;
};

export function ChatMessageBubble(props: ChatMessageBubbleProps): JSX.Element {
  const className = [
    "chat-bubble",
    `chat-bubble-${props.role}`,
    props.ghosted ? "chat-bubble-ghosted" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className}>
      <div className="chat-bubble-text">{props.text}</div>
      {props.footer ? <div className="chat-bubble-footer">{props.footer}</div> : null}
    </div>
  );
}
