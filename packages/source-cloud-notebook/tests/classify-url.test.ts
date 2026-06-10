import { describe, expect, it } from "vitest";
import { classifyUrl } from "../src/validation-report.js";

describe("classifyUrl", () => {
  it("returns notebook for the legacy /kp/notebook path", () => {
    expect(classifyUrl("https://read.amazon.com/kp/notebook")).toBe("notebook");
    expect(classifyUrl("https://read.amazon.com/kp/notebook?asin=B01FPGY5T0")).toBe("notebook");
  });

  it("returns notebook for the current /notebook path", () => {
    expect(classifyUrl("https://read.amazon.com/notebook")).toBe("notebook");
    expect(classifyUrl("https://read.amazon.com/notebook?asin=B01FPGY5T0")).toBe("notebook");
    expect(classifyUrl("https://read.amazon.com/notebook/")).toBe("notebook");
  });

  it("does not match longer paths that merely share the /notebook prefix", () => {
    expect(classifyUrl("https://read.amazon.com/notebooks")).toBe("interstitial_other");
  });

  it("detects sign-in pages", () => {
    expect(classifyUrl("https://www.amazon.com/ap/signin?openid.return_to=…")).toBe("signin");
    expect(classifyUrl("https://www.amazon.com/gp/sign-in.html")).toBe("signin");
  });

  it("detects MFA and captcha challenges", () => {
    expect(classifyUrl("https://www.amazon.com/ap/mfa")).toBe("mfa");
    expect(classifyUrl("https://www.amazon.com/errors/validateCaptcha")).toBe("captcha");
  });

  it("detects continue-shopping interstitial", () => {
    expect(classifyUrl("https://www.amazon.com/ap/cnep?continue=…")).toBe("interstitial_continue_shopping");
  });

  it("classifies any other amazon page as interstitial_other", () => {
    expect(classifyUrl("https://www.amazon.com/gp/yourstore/home")).toBe("interstitial_other");
  });

  it("returns unknown for non-amazon hosts and invalid urls", () => {
    expect(classifyUrl("https://example.com/anywhere")).toBe("unknown");
    expect(classifyUrl("not a url at all")).toBe("unknown");
    expect(classifyUrl("")).toBe("unknown");
  });

  it("rejects amazon-lookalike hosts that have extra subdomain segments after the TLD", () => {
    expect(classifyUrl("https://amazon.com.evil.io/ap/signin")).toBe("unknown");
    expect(classifyUrl("https://amazon.co.uk.attacker.com/kp/notebook")).toBe("unknown");
  });
});
