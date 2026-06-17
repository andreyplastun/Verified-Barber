export type ActivationStepKey =
  | "photo"
  | "price"
  | "contact"
  | "add_client"
  | "first_review"
  | "bio"
  | "address";

export interface ActivationStepConfig {
  key: ActivationStepKey;
  weight: number;
  required: boolean;
  label: string;
  description?: string;
}

// NOTE: `add_client` and `address` carry weight 0 — guidance steps that must not
// affect the activation score, so total weight stays at 100. `add_client` is shown
// only to specialists WITHOUT Altegio (who must create visits manually). `address`
// is optional but powers the "Рядом со мной" geo-sort on the client list.
export const ACTIVATION_STEPS: ActivationStepConfig[] = [
  { key: "photo", weight: 20, required: true, label: "Добавить фото" },
  { key: "price", weight: 15, required: true, label: "Указать основную услугу и цену" },
  { key: "contact", weight: 20, required: true, label: "Добавить способ записи" },
  { key: "add_client", weight: 0, required: true, label: "Добавить первого клиента" },
  { key: "first_review", weight: 30, required: true, label: "Получить первый отзыв" },
  { key: "bio", weight: 15, required: false, label: "Добавить описание" },
  { key: "address", weight: 0, required: false, label: "Указать адрес места работы" },
];

// Steps that gate a specialist's ability to start collecting reviews
// (everything needed before the first review can come in).
export const REVIEW_GATE_STEPS: ActivationStepKey[] = ["photo", "price", "contact"];

// Steps shown in the checklist for a given context. `add_client` is hidden when
// Altegio is connected (visits are created automatically via Altegio).
export function getVisibleSteps(opts: { isAltegio: boolean }): ActivationStepConfig[] {
  return ACTIVATION_STEPS.filter(
    (s) => s.key !== "add_client" || !opts.isAltegio,
  );
}

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
