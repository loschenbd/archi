type Props = {
  entries: string[];
};

export function LogsScreen({ entries }: Props): JSX.Element {
  return (
    <section className="logs-screen">
      <header className="screen-intro">
        <p>Recent sync activity and diagnostic events.</p>
      </header>
      {entries.length === 0 ? (
        <p>No sync job logs yet.</p>
      ) : (
        <ul className="logs-list">
          {entries.map((entry) => (
            <li key={entry} className="log-item">
              {entry}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
