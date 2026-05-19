import { describe, expect, it } from "vitest";
import { mapCloudStatusToConnectionStatus } from "../src/main/connections.js";

describe("mapCloudStatusToConnectionStatus", () => {
  it("maps connected states to connected", () => {
    expect(mapCloudStatusToConnectionStatus("connected")).toBe("connected");
    expect(mapCloudStatusToConnectionStatus("reconnected")).toBe("connected");
  });

  it("maps needs_auth to needs_action", () => {
    expect(mapCloudStatusToConnectionStatus("needs_auth")).toBe("needs_action");
  });
});

