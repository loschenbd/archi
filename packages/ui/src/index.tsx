import type { PropsWithChildren } from "react";

export function ScreenCard({ children }: PropsWithChildren): JSX.Element {
  return <section style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>{children}</section>;
}
