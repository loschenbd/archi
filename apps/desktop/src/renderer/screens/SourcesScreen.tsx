type Props = {
  syncStatus: string;
  onReconnect: () => void;
  deviceExportPath: string;
  onChooseDeviceExportPath: () => void;
};

export function SourcesScreen({ syncStatus, onReconnect, deviceExportPath, onChooseDeviceExportPath }: Props): JSX.Element {
  return (
    <>
      <h2>Sources</h2>
      <p>Configure cloud notebook auth and local Kindle export file path.</p>
      <p>
        <strong>Device export file:</strong> {deviceExportPath}
      </p>
      <button onClick={onChooseDeviceExportPath}>Choose export file</button>
      {syncStatus === "needs_auth" ? (
        <p>
          Cloud notebook session expired. <button onClick={onReconnect}>Reconnect and resume</button>
        </p>
      ) : null}
      <ul>
        <li>Device export: tier-1 stable source</li>
        <li>Cloud notebook: tier-2 best-effort source</li>
      </ul>
    </>
  );
}
