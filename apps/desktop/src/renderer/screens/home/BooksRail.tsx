type Work = {
  id: string;
  title: string;
  creator?: string;
  coverImageUrl?: string;
  ingestedAt: string;
};

type Props = {
  works: Work[];
  deltaCount: number;
  onOpenWork: (workId: string) => void;
};

export function BooksRail({ works, deltaCount, onOpenWork }: Props): JSX.Element {
  return (
    <section className="books-rail">
      <header className="books-rail-head">
        <p className="content-eyebrow">Recently added</p>
        {deltaCount > 0 ? (
          <span className="books-rail-new-chip">+{deltaCount} new</span>
        ) : null}
      </header>
      {works.length === 0 ? (
        <p className="books-rail-empty">Nothing yet — run a sync to start filling your library.</p>
      ) : (
        <ul className="books-rail-track">
          {works.slice(0, 12).map((work) => (
            <li key={work.id} className="books-rail-tile">
              <button
                type="button"
                className="books-rail-tile-button"
                onClick={() => onOpenWork(work.id)}
              >
                <span className="books-rail-tile-cover" aria-hidden="true">
                  {work.coverImageUrl ? (
                    <img src={work.coverImageUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="books-rail-tile-cover-letter">
                      {(work.title[0] ?? "?").toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="books-rail-tile-title">{work.title}</span>
                {work.creator ? (
                  <span className="books-rail-tile-creator">{work.creator}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
