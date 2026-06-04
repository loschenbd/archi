type Props = {
  connectionStatus: string;
};

export function NotionScreen({ connectionStatus }: Props): JSX.Element {
  return (
    <>
      <h2>Notion</h2>
      <p>Connection: {connectionStatus}</p>
      <p>On first run, Archi auto-creates your Library database in Notion and syncs your highlights as related entries.</p>
    </>
  );
}
