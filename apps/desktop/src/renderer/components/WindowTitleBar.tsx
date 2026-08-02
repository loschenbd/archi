/**
 * The draggable strip behind the native macOS traffic lights.
 *
 * It used to also render a custom close button, which duplicated (and
 * covered) the real window controls once those were made visible — and it
 * only offered close, with no minimize or zoom.
 *
 * Anything rendered at the top of the document sits *under* this strip and is
 * unclickable; see the top padding on `.update-banner`.
 */
export function WindowTitleBar(): JSX.Element {
  return <div className="window-titlebar" />;
}
