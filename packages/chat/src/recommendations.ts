export type RecommendedModel = {
  name: string;
  approxDownloadBytes: number;
  notes: string;
};

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    name: "llama3.1:8b",
    approxDownloadBytes: 4_700_000_000,
    notes: "Default. Runs comfortably on 8GB Apple Silicon and up.",
  },
  {
    name: "phi3:mini",
    approxDownloadBytes: 2_300_000_000,
    notes: "Lighter fallback for older or memory-constrained Macs.",
  },
];

export function isRecommended(name: string): boolean {
  return RECOMMENDED_MODELS.some((m) => m.name === name);
}

export function defaultRecommendation(): RecommendedModel {
  const first = RECOMMENDED_MODELS[0];
  if (!first) throw new Error("RECOMMENDED_MODELS must not be empty");
  return first;
}
