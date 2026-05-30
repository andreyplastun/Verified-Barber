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
  { key: "price", weight: 15, required: true, label: "Указать основную услугу и цену" },
  { key: "contact", weight: 20, required: true, label: "Добавить способ записи" },
  { key: "first_review", weight: 30, required: true, label: "Получите первый отзыв" },
  { key: "bio", weight: 15, required: false, label: "Добавить описание" },
];

// Steps that gate a specialist's ability to start collecting reviews
// (everything needed before the first review can come in).
export const REVIEW_GATE_STEPS: ActivationStepKey[] = ["photo", "price", "contact"];

export function stepsUntilFirstReview(completed: CompletedSteps): number {
  return REVIEW_GATE_STEPS.filter((k) => !completed[k]).length;
}

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
