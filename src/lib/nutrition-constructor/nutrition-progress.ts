export type NutritionProgress = {
  stage: string;
  progress: number;
  found?: number;
  total?: number;
};

let sink: ((progress: NutritionProgress) => void) | null = null;

export function setNutritionProgressSink(next: ((progress: NutritionProgress) => void) | null): void {
  sink = next;
}

export function reportNutritionProgress(progress: NutritionProgress): void {
  sink?.(progress);
}
