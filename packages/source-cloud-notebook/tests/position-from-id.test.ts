import { describe, expect, it } from "vitest";
import { decodeKindleHighlightLocation } from "../src/index.js";

describe("decodeKindleHighlightLocation", () => {
  const encode = (value: string): string => Buffer.from(value, "utf8").toString("base64");

  it("extracts the location from a base64 annotation id", () => {
    const id = encode("A35AKBU4SUIQU8:B01FPGY5T0:45873:HIGHLIGHT:a3PVXHSE4YINRO");
    expect(decodeKindleHighlightLocation(id)).toEqual({ positionStart: "45873", positionKind: "location" });
  });

  it("strips a '<namespace>::' prefix before decoding", () => {
    const inner = encode("A35AKBU4SUIQU8:B01FPGY5T0:161084:HIGHLIGHT:a2NEBL68KAZGSM");
    expect(decodeKindleHighlightLocation(`B01FPGY5T0::${inner}`)).toEqual({
      positionStart: "161084",
      positionKind: "location"
    });
  });

  it("returns null when the third field is not numeric", () => {
    const id = encode("A35AKBU4:B01FPGY5T0:not-a-number:HIGHLIGHT:abc");
    expect(decodeKindleHighlightLocation(id)).toBeNull();
  });

  it("returns null for inputs that don't decode to a known shape", () => {
    expect(decodeKindleHighlightLocation("")).toBeNull();
    expect(decodeKindleHighlightLocation("not-base64-???")).toBeNull();
    expect(decodeKindleHighlightLocation(undefined)).toBeNull();
    expect(decodeKindleHighlightLocation(encode("only:two"))).toBeNull();
  });
});
