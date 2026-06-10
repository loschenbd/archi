export type FusedHit = {
  key: string;
  score: number;
  sourceIndices: number[];
};

export function fuseRrf<T>(
  rankedLists: T[][],
  keyOf: (item: T) => string,
  options: { k: number; limit: number }
): FusedHit[] {
  const acc = new Map<string, FusedHit>();
  rankedLists.forEach((list, listIdx) => {
    list.forEach((item, rank) => {
      const key = keyOf(item);
      const contribution = 1 / (options.k + rank);
      const existing = acc.get(key);
      if (existing) {
        existing.score += contribution;
        if (!existing.sourceIndices.includes(listIdx)) {
          existing.sourceIndices.push(listIdx);
        }
      } else {
        acc.set(key, { key, score: contribution, sourceIndices: [listIdx] });
      }
    });
  });
  return Array.from(acc.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit);
}
