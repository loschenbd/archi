export function toRoman(n: number): string {
  if (!Number.isFinite(n) || n < 1) return String(n);
  const map: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let remaining = Math.floor(n);
  for (const [value, sym] of map) {
    while (remaining >= value) {
      out += sym;
      remaining -= value;
    }
  }
  return out;
}
