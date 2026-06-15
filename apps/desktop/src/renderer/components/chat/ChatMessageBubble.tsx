import type { ReactNode } from "react";

export type ChatBubbleRole = "user" | "assistant";

export type ChatMessageBubbleProps = {
  role: ChatBubbleRole;
  text: ReactNode;
  footer?: ReactNode;
  ghosted?: boolean;
};

export function ChatMessageBubble(props: ChatMessageBubbleProps): JSX.Element {
  const isUser = props.role === "user";
  const className = [
    isUser ? "chat-bubble-user-v2" : "ui-card ui-card--tight",
    "chat-bubble-v2",
    `chat-bubble-v2--${props.role}`,
    props.ghosted ? "chat-bubble-v2--ghosted" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className}>
      <div className="chat-bubble-v2__text">{props.text}</div>
      {props.footer ? <div className="chat-bubble-v2__footer">{props.footer}</div> : null}
    </div>
  );
}
