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
    <div className="chat-sources-v2">
      <h3 className="ui-card__eyebrow">Sources</h3>
      <ol className="chat-citations-v2">
        {citations.map((c, i) => (
          <li
            key={c.passageId}
            id={`citation-${messageId}-${i + 1}`}
            className="chat-citation-v2"
          >
            <span className="chat-citation-v2__number">
              <span className="ui-footnote-ref" aria-hidden="true">{i + 1}</span>
            </span>
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
