import type { SearchResult } from "@archi/search";
import { SearchResultCard } from "../SearchResultCard.js";

export type ChatCitationListProps = {
  citations: SearchResult[];
  messageId: string;
  onOpenWork: (workId: string, passageId: string) => void;
};

export function ChatCitationList({
  citations,
  messageId,
  onOpenWork,
}: ChatCitationListProps): JSX.Element {
  if (citations.length === 0) return <></>;
  return (
    <div className="chat-sources">
      <h3 className="chat-sources-header">Sources</h3>
      <ol className="chat-citations">
        {citations.map((c, i) => (
          <li
            key={c.passageId}
            id={`citation-${messageId}-${i + 1}`}
            className="chat-citation"
          >
            <div className="chat-citation-number">[{i + 1}]</div>
            <SearchResultCard
              result={c}
              showMatchSource={false}
              expanded={false}
              onToggle={() => undefined}
              onOpenWork={onOpenWork}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
