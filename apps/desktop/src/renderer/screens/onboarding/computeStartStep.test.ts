import { describe, expect, it } from "vitest";
import { computeStartStep } from "./computeStartStep";

describe("computeStartStep", () => {
  it("returns 1 when no connections snapshot is available", () => {
    expect(computeStartStep(null)).toBe(1);
    expect(computeStartStep(undefined)).toBe(1);
    expect(computeStartStep({})).toBe(1);
  });

  it("returns 1 when both connections are still configuring or disconnected", () => {
    expect(
      computeStartStep({
        notion: { status: "configuring" },
        cloud_notebook: { status: "configuring" },
      })
    ).toBe(1);
    expect(
      computeStartStep({
        notion: { status: "disconnected" },
        cloud_notebook: { status: "needs_action" },
      })
    ).toBe(1);
  });

  it("returns 2 when only Kindle is connected (Notion still gates the flow)", () => {
    expect(
      computeStartStep({
        notion: { status: "needs_action" },
        cloud_notebook: { status: "connected" },
      })
    ).toBe(2);
  });

  it("returns 3 when only Notion is connected", () => {
    expect(
      computeStartStep({
        notion: { status: "connected" },
        cloud_notebook: { status: "disconnected" },
      })
    ).toBe(3);
  });

  it("returns 4 when both Notion and Kindle are connected", () => {
    expect(
      computeStartStep({
        notion: { status: "connected" },
        cloud_notebook: { status: "connected" },
      })
    ).toBe(4);
  });

  it("treats unknown status strings as not-connected (defaults to step 1)", () => {
    expect(
      computeStartStep({
        notion: { status: "weird_value" },
        cloud_notebook: { status: "another_weird_value" },
      })
    ).toBe(1);
  });

  it("tolerates missing connection keys without throwing", () => {
    expect(computeStartStep({ notion: { status: "connected" } })).toBe(3);
    expect(computeStartStep({ cloud_notebook: { status: "connected" } })).toBe(2);
  });
});
