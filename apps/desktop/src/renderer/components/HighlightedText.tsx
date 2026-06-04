import { Fragment } from "react";

type Props = {
  snippet: string;
};

const MARK_REGEX = /(<mark>.*?<\/mark>)/g;

export function HighlightedText({ snippet }: Props): JSX.Element {
  const parts = snippet.split(MARK_REGEX);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("<mark>") && part.endsWith("</mark>") ? (
          <mark key={i}>{part.slice("<mark>".length, -"</mark>".length)}</mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}
