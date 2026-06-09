import type { ConnectionsSnapshot, Step } from "./types";

export function computeStartStep(connections: ConnectionsSnapshot | null | undefined): Step {
  if (!connections) {
    return 1;
  }
  const notionConnected = connections.notion?.status === "connected";
  const kindleConnected = connections.cloud_notebook?.status === "connected";

  if (notionConnected && kindleConnected) {
    return 4;
  }
  if (notionConnected) {
    return 3;
  }
  if (kindleConnected) {
    return 2;
  }
  return 1;
}
