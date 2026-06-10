import { describe, expect, it } from "vitest";
import { nextCloudAuthSurfaced } from "../src/main/cloudAuthSurfaced.js";
import { maskConnectionForBanner, type RawConnection } from "../src/renderer/lib/syncBannerMapping";

describe("nextCloudAuthSurfaced", () => {
  it("user-initiated needs_auth surfaces the banner", () => {
    expect(nextCloudAuthSurfaced(false, "needs_auth", "user")).toBe(true);
  });

  it("auto-initiated needs_auth does NOT surface (current preserved)", () => {
    expect(nextCloudAuthSurfaced(false, "needs_auth", "auto")).toBe(false);
    expect(nextCloudAuthSurfaced(true, "needs_auth", "auto")).toBe(true);
  });

  it("successful cloud fetch clears the banner regardless of trigger", () => {
    expect(nextCloudAuthSurfaced(true, "success", "auto")).toBe(false);
    expect(nextCloudAuthSurfaced(true, "success", "user")).toBe(false);
    expect(nextCloudAuthSurfaced(false, "success", "auto")).toBe(false);
  });

  it("other outcomes (e.g. partial_success, skipped) leave current intact", () => {
    expect(nextCloudAuthSurfaced(true, "other", "user")).toBe(true);
    expect(nextCloudAuthSurfaced(false, "other", "user")).toBe(false);
    expect(nextCloudAuthSurfaced(true, "skipped", "auto")).toBe(true);
    expect(nextCloudAuthSurfaced(false, "skipped", "auto")).toBe(false);
  });
});

describe("maskConnectionForBanner", () => {
  const cloud = (status: RawConnection["status"], enabled = true): RawConnection => ({
    provider: "cloud_notebook",
    label: "Cloud notebook",
    status,
    metadata: { enabled }
  });

  it("hides cloud needs_action when banner has not been surfaced", () => {
    const result = maskConnectionForBanner(cloud("needs_action"), false);
    expect(result.status).toBe("connected");
  });

  it("shows cloud needs_action when banner has been surfaced", () => {
    const result = maskConnectionForBanner(cloud("needs_action"), true);
    expect(result.status).toBe("needs_action");
  });

  it("does NOT mask other cloud states (error, disconnected, configuring)", () => {
    expect(maskConnectionForBanner(cloud("error"), false).status).toBe("error");
    expect(maskConnectionForBanner(cloud("disconnected"), false).status).toBe("disconnected");
    expect(maskConnectionForBanner(cloud("configuring"), false).status).toBe("configuring");
  });

  it("never masks notion needs_action — gate applies only to cloud_notebook", () => {
    const notion: RawConnection = {
      provider: "notion",
      label: "Notion",
      status: "needs_action",
      metadata: { enabled: true }
    };
    expect(maskConnectionForBanner(notion, false).status).toBe("needs_action");
    expect(maskConnectionForBanner(notion, true).status).toBe("needs_action");
  });

  it("never masks device_export needs_action either", () => {
    const device: RawConnection = {
      provider: "device_export",
      label: "Device export",
      status: "needs_action",
      metadata: { enabled: true }
    };
    expect(maskConnectionForBanner(device, false).status).toBe("needs_action");
  });

  it("derives enabled from metadata.enabled (defaults true)", () => {
    expect(maskConnectionForBanner(cloud("connected", true), false).enabled).toBe(true);
    expect(maskConnectionForBanner(cloud("connected", false), false).enabled).toBe(false);
    const noMeta: RawConnection = {
      provider: "cloud_notebook",
      label: "Cloud notebook",
      status: "connected",
      metadata: null
    };
    expect(maskConnectionForBanner(noMeta, false).enabled).toBe(true);
  });
});
