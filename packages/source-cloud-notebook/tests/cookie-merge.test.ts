import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStorageStateCookies, filterNewCookies } from "../src/validation-report.js";

describe("parseStorageStateCookies", () => {
  it("returns the cookies array from a valid storage-state file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ssc-"));
    const path = join(dir, "storage-state.json");
    writeFileSync(
      path,
      JSON.stringify({
        cookies: [
          { name: "at-main", value: "abc", domain: ".amazon.com", path: "/" },
          { name: "ubid-main", value: "xyz", domain: ".amazon.com", path: "/" }
        ],
        origins: []
      }),
      "utf8"
    );
    const cookies = parseStorageStateCookies(path);
    expect(cookies).toHaveLength(2);
    expect(cookies[0].name).toBe("at-main");
  });

  it("returns empty array when the file doesn't exist", () => {
    expect(parseStorageStateCookies("/no/such/file")).toEqual([]);
  });

  it("returns empty array when JSON is malformed (fails closed)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ssc-"));
    const path = join(dir, "broken.json");
    writeFileSync(path, "{not json", "utf8");
    expect(parseStorageStateCookies(path)).toEqual([]);
  });

  it("returns empty array when cookies field is missing or wrong shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "ssc-"));
    const path = join(dir, "no-cookies.json");
    writeFileSync(path, '{"origins":[]}', "utf8");
    expect(parseStorageStateCookies(path)).toEqual([]);
  });
});

describe("filterNewCookies", () => {
  it("returns all cookies when existing jar is empty", () => {
    const incoming = [
      { name: "at-main", value: "a", domain: ".amazon.com", path: "/" },
      { name: "ubid-main", value: "b", domain: ".amazon.com", path: "/" }
    ];
    expect(filterNewCookies(incoming, [])).toEqual(incoming);
  });

  it("filters out cookies that match on name+domain+path", () => {
    const existing = [{ name: "at-main", domain: ".amazon.com", path: "/" }];
    const incoming = [
      { name: "at-main", value: "new", domain: ".amazon.com", path: "/" },
      { name: "ubid-main", value: "new", domain: ".amazon.com", path: "/" }
    ];
    const result = filterNewCookies(incoming, existing);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ubid-main");
  });

  it("treats different domains as different cookies", () => {
    const existing = [{ name: "at-main", domain: ".amazon.com", path: "/" }];
    const incoming = [{ name: "at-main", value: "new", domain: ".amazon.de", path: "/" }];
    const result = filterNewCookies(incoming, existing);
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe(".amazon.de");
  });
});
