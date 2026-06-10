export function WindowTitleBar(): JSX.Element {
  return (
    <div className="window-titlebar">
      <button
        type="button"
        className="window-close-button"
        aria-label="Close window"
        onClick={() => {
          void window.archi.closeWindow();
        }}
      />
    </div>
  );
}
