import type { SearchResult } from "@archi/search";
import { SearchResultCard } from "../SearchResultCard.js";

export type ChatCitationListProps = {
  citations: SearchResult[];
  onOpenWork: (workId: string, passageId: string) => void;
};

export function ChatCitationList({ citations, onOpenWork }: ChatCitationListProps): JSX.Element {
  if (citations.length === 0) return <></>;
  return (
    <ol className="chat-citations">
      {citations.map((c, i) => (
        <li key={c.passageId} className="chat-citation">
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
  );
}
