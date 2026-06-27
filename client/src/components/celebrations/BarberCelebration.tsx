import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

export type CelebrationType =
  | "first_review"
  | "rating_appeared"
  | "count_milestone"
  | "new_record"
  | "rating_dropped"
  | "achievement";

export type CelebrationEvent = {
  type: CelebrationType;
  rating?: number;
  count?: number;
  // For type === "achievement": custom badge copy.
  title?: string;
  message?: string;
  cta?: string;
};

type Variant = "spin" | "gold" | "cracked";

const STRIPES: Record<Variant, string> = {
  spin: "repeating-linear-gradient(135deg, #e11d48 0 14px, #ffffff 14px 28px, #2563eb 28px 42px)",
  gold: "repeating-linear-gradient(135deg, #b45309 0 14px, #fde68a 14px 28px, #f59e0b 28px 42px)",
  cracked: "repeating-linear-gradient(135deg, #6b7280 0 14px, #e5e7eb 14px 28px, #9ca3af 28px 42px)",
};

function BarberPole({ variant }: { variant: Variant }) {
  const reduced = useReducedMotion();
  const animate =
    variant === "cracked" || reduced
      ? {}
      : { backgroundPositionY: ["0px", "-60px"] };

  return (
    <div className="relative flex flex-col items-center" aria-hidden="true">
      {/* glow */}
      <motion.div
        className="absolute inset-0 -z-10 mx-auto my-auto rounded-full blur-2xl"
        style={{
          width: 120,
          height: 120,
          background:
            variant === "gold"
              ? "radial-gradient(circle, rgba(245,158,11,0.55), transparent 70%)"
              : variant === "cracked"
              ? "radial-gradient(circle, rgba(100,116,139,0.25), transparent 70%)"
              : "radial-gradient(circle, rgba(37,99,235,0.4), transparent 70%)",
        }}
        animate={reduced ? {} : { scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
      />

      {/* top cap */}
      <div
        className="h-3 w-16 rounded-t-full"
        style={{ background: "linear-gradient(180deg,#f8fafc,#94a3b8)" }}
      />
      <div
        className="h-2 w-20 rounded-full"
        style={{ background: "linear-gradient(180deg,#e2e8f0,#64748b)" }}
      />

      {/* glass cylinder with spinning stripes */}
      <div
        className="relative h-44 w-12 overflow-hidden"
        style={{
          borderRadius: 24,
          boxShadow:
            "inset 6px 0 10px rgba(255,255,255,0.5), inset -7px 0 12px rgba(0,0,0,0.28)",
        }}
      >
        <motion.div
          className="absolute inset-0"
          style={{
            background: STRIPES[variant],
            backgroundSize: "100% 60px",
            filter: variant === "cracked" ? "saturate(0.6) brightness(0.95)" : undefined,
          }}
          animate={animate}
          transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
        />
        {/* glass highlight */}
        <div
          className="pointer-events-none absolute inset-y-0 left-1 w-2 rounded-full"
          style={{ background: "linear-gradient(90deg,rgba(255,255,255,0.85),transparent)" }}
        />

        {/* crack overlay */}
        {variant === "cracked" && (
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 48 176"
            preserveAspectRatio="none"
          >
            <motion.path
              d="M24 6 L20 42 L30 58 L18 92 L29 120 L21 150 L26 172"
              fill="none"
              stroke="rgba(15,23,42,0.85)"
              strokeWidth={2.4}
              strokeLinecap="round"
              initial={{ pathLength: reduced ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
            <motion.path
              d="M20 42 L12 50 M30 58 L40 64 M18 92 L9 100 M29 120 L39 128"
              fill="none"
              stroke="rgba(15,23,42,0.6)"
              strokeWidth={1.6}
              strokeLinecap="round"
              initial={{ opacity: reduced ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.4 }}
            />
          </svg>
        )}
      </div>

      {/* bottom cap */}
      <div
        className="h-2 w-20 rounded-full"
        style={{ background: "linear-gradient(180deg,#e2e8f0,#64748b)" }}
      />
      <div
        className="h-3 w-16 rounded-b-full"
        style={{ background: "linear-gradient(180deg,#94a3b8,#475569)" }}
      />

      {/* crown for record */}
      {variant === "gold" && (
        <motion.svg
          className="absolute -top-7"
          width="56"
          height="36"
          viewBox="0 0 56 36"
          initial={reduced ? false : { y: -12, opacity: 0, rotate: -8 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.15 }}
        >
          <path
            d="M4 32 L8 10 L20 22 L28 4 L36 22 L48 10 L52 32 Z"
            fill="#f59e0b"
            stroke="#b45309"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <circle cx="28" cy="4" r="3" fill="#fde68a" />
          <circle cx="8" cy="10" r="2.6" fill="#fde68a" />
          <circle cx="48" cy="10" r="2.6" fill="#fde68a" />
        </motion.svg>
      )}
    </div>
  );
}

function Sparks({ color = "#f59e0b" }: { color?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  const rays = Array.from({ length: 10 });
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {rays.map((_, i) => {
        const angle = (i / rays.length) * Math.PI * 2;
        return (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{ width: 4, height: 16, background: color, transformOrigin: "center" }}
            initial={{ opacity: 0, x: 0, y: 0, rotate: (angle * 180) / Math.PI }}
            animate={{
              opacity: [0, 1, 0],
              x: Math.cos(angle) * 90,
              y: Math.sin(angle) * 90,
            }}
            transition={{ duration: 0.9, delay: 0.1 + i * 0.02, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}

function StarsBurst() {
  const reduced = useReducedMotion();
  if (reduced) return null;
  const stars = Array.from({ length: 7 });
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {stars.map((_, i) => {
        const angle = (i / stars.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <motion.svg
            key={i}
            width="22"
            height="22"
            viewBox="0 0 24 24"
            className="absolute"
            initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
            animate={{
              opacity: [0, 1, 0],
              scale: [0, 1.1, 0.8],
              x: Math.cos(angle) * 100,
              y: Math.sin(angle) * 100,
            }}
            transition={{ duration: 1, delay: 0.05 * i, ease: "easeOut" }}
          >
            <polygon
              points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              fill="#facc15"
            />
          </motion.svg>
        );
      })}
    </div>
  );
}

const COPY: Record<
  CelebrationType,
  (e: CelebrationEvent) => { variant: Variant; title: string; message: string; cta: string; effect: "sparks" | "stars" | "none" }
> = {
  first_review: () => ({
    variant: "spin",
    title: "Первый отзыв!",
    message: "Лёд тронулся. Так держать — дальше будет только больше.",
    cta: "Класс",
    effect: "sparks",
  }),
  rating_appeared: (e) => ({
    variant: "spin",
    title: "Твой рейтинг засветился!",
    message: `Уже ${e.rating?.toFixed(1)} ★ — теперь клиенты видят, какой ты мастер.`,
    cta: "Поехали",
    effect: "sparks",
  }),
  count_milestone: (e) => ({
    variant: "spin",
    title: `${e.count} отзывов!`,
    message: "Серьёзная цифра. Клиенты возвращаются и рассказывают о тебе.",
    cta: "Огонь",
    effect: "stars",
  }),
  new_record: (e) => ({
    variant: "gold",
    title: "Новый рекорд!",
    message: `${e.rating?.toFixed(1)} ★ — твой лучший рейтинг за всё время. Корона по праву.`,
    cta: "Беру корону",
    effect: "sparks",
  }),
  rating_dropped: () => ({
    variant: "cracked",
    title: "Рейтинг чуть просел",
    message: "Бывает у каждого. Пара хороших отзывов — и столб снова закрутится.",
    cta: "Поднажму",
    effect: "none",
  }),
  achievement: (e) => ({
    variant: "gold",
    title: e.title || "Новая награда!",
    message: e.message || "Ты заслужил награду. Так держать!",
    cta: e.cta || "Беру награду",
    effect: "stars",
  }),
};

export function BarberCelebrationOverlay({
  event,
  onClose,
}: {
  event: CelebrationEvent | null;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const cfg = event ? COPY[event.type](event) : null;

  return (
    <AnimatePresence>
      {event && cfg && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          data-testid="overlay-celebration"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
          <motion.div
            className="relative w-full max-w-xs rounded-3xl bg-card p-6 text-center shadow-2xl"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 10 }}
            transition={{ type: "spring", stiffness: 280, damping: 22 }}
            onClick={(ev) => ev.stopPropagation()}
            data-testid={`celebration-${event.type}`}
          >
            <div className="relative mx-auto mb-5 flex h-56 w-full items-center justify-center">
              {cfg.effect === "sparks" && <Sparks color={cfg.variant === "gold" ? "#f59e0b" : "#3b82f6"} />}
              {cfg.effect === "stars" && <StarsBurst />}
              <BarberPole variant={cfg.variant} />
            </div>
            <h2 className="text-xl font-bold" data-testid="text-celebration-title">
              {cfg.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground" data-testid="text-celebration-message">
              {cfg.message}
            </p>
            <button
              onClick={onClose}
              className="mt-5 w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              data-testid="button-celebration-close"
            >
              {cfg.cta}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
