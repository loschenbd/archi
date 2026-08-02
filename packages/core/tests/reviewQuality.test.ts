import { describe, expect, it } from "vitest";
import { isCompleteSentence, MIN_RESURFACE_LENGTH } from "../src/review/quality.js";

describe("isCompleteSentence", () => {
  it("accepts a short but complete sentence", () => {
    expect(isCompleteSentence("You are as big as the things that make you angry.")).toBe(true);
    expect(isCompleteSentence("Read the books that your favorite authors once read.")).toBe(true);
  });

  it("rejects a continuation fragment even when it ends in a full stop", () => {
    // The motivating case: Kindle split a highlight and this is the tail.
    expect(isCompleteSentence("people's rejection of His Father.")).toBe(false);
  });

  it("rejects a sentence that stops mid-thought", () => {
    expect(
      isCompleteSentence("There are many things to consider when assessing source systems, including")
    ).toBe(false);
  });

  it("accepts text opening with a quotation mark", () => {
    expect(isCompleteSentence("“Silence is a statement, Diago. Inaction picks a side.”")).toBe(true);
    expect(isCompleteSentence('"We don\'t have to be," he laughs.')).toBe(true);
  });

  it("accepts text opening with a digit", () => {
    expect(isCompleteSentence("1970 was the year everything changed for them.")).toBe(true);
  });

  it("rejects anything below the length floor", () => {
    expect("Too short.".length).toBeLessThan(MIN_RESURFACE_LENGTH);
    expect(isCompleteSentence("Too short.")).toBe(false);
  });

  it("rejects empty and whitespace-only input", () => {
    expect(isCompleteSentence("")).toBe(false);
    expect(isCompleteSentence("      ")).toBe(false);
  });

  it("does not hide caseless scripts, the documented failure mode of this filter", () => {
    // Chinese, Japanese and Arabic have no capital letters, so a
    // starts-with-a-capital rule would reject every one of these.
    expect(isCompleteSentence("学而时习之，不亦说乎？有朋自远方来，不亦乐乎？")).toBe(true);
    expect(isCompleteSentence("吾輩は猫である。名前はまだ無い。まだどこで生れたか見当がつかぬ。")).toBe(true);
    expect(isCompleteSentence("العلم نور والجهل ظلام، فاطلب العلم من المهد إلى اللحد۔")).toBe(true);
  });

  it("still requires terminal punctuation in a caseless script", () => {
    expect(isCompleteSentence("学而时习之，不亦说乎有朋自远方来，不亦乐乎")).toBe(false);
  });

  it("accepts an ellipsis as a terminator", () => {
    expect(isCompleteSentence("And so the whole thing simply trailed off into nothing…")).toBe(true);
  });
});
