export type ActivationStepKey = "photo" | "price" | "contact" | "bio" | "first_review";

export interface ActivationStepConfig {
  key: ActivationStepKey;
  weight: number;
  required: boolean;
  label: string;
  description?: string;
}

export const ACTIVATION_STEPS: ActivationStepConfig[] = [
  { key: "photo", weight: 20, required: true, label: "Добавить фото" },
  { key: "price", weight: 15, required: true, label: "Указать цену" },
  { key: "contact", weight: 20, required: true, label: "Добавить способ записи" },
  { key: "bio", weight: 15, required: false, label: "Добавить описание" },
  { key: "first_review", weight: 30, required: true, label: "Получите первый отзыв" },
];

export const ACTIVATION_MAX_SCORE = ACTIVATION_STEPS.reduce((s, x) => s + x.weight, 0);

export type CompletedSteps = Partial<Record<ActivationStepKey, boolean>>;

export function computeActivationScore(completed: CompletedSteps): number {
  let s = 0;
  for (const step of ACTIVATION_STEPS) {
    if (completed[step.key]) s += step.weight;
  }
  return Math.min(100, Math.max(0, s));
}

export function remainingStepsCount(completed: CompletedSteps): number {
  return ACTIVATION_STEPS.filter(s => !completed[s.key]).length;
}
