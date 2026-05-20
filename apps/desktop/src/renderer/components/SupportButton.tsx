type Props = {
  collapsed: boolean;
};

export function SupportButton({ collapsed }: Props): JSX.Element {
  const handleClick = (): void => {
    void window.archi.openSupportLink();
  };

  return (
    <button
      type="button"
      className="support-button"
      onClick={handleClick}
      aria-label="Support Archi"
      title={collapsed ? "Support Archi" : undefined}
    >
      <span className="support-button-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6Z" />
          <path d="M11 7h1.5a1.5 1.5 0 0 1 0 3H11" />
          <path d="M5 3.5c0 .8.5 1 .5 2M7.5 3.5c0 .8.5 1 .5 2" strokeLinecap="round" />
        </svg>
      </span>
      {!collapsed && <span className="support-button-label">Support Archi</span>}
    </button>
  );
}
