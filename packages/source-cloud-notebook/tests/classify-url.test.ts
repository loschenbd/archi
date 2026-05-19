import { describe, expect, it } from "vitest";
import { classifyUrl } from "../src/validation-report.js";

describe("classifyUrl", () => {
  it("returns notebook for the notebook path", () => {
    expect(classifyUrl("https://read.amazon.com/kp/notebook")).toBe("notebook");
    expect(classifyUrl("https://read.amazon.com/kp/notebook?asin=B01FPGY5T0")).toBe("notebook");
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
});
