import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useRef, useEffect, useState, useCallback } from "react";
import { useRatingTheme } from "@/hooks/use-rating-theme";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const reviewCardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.22, ease: "easeOut" },
  }),
};

export function AnimatedRating({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const prevRef = useRef(value);
  const [key, setKey] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      setKey((k) => k + 1);
    }
  }, [value]);

  if (reduced) {
    return <span className={className}>{value}</span>;
  }

  return (
    <span className={`inline-block relative ${className ?? ""}`} style={{ minWidth: "2ch" }}>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={key}
          initial={key > 0 ? { opacity: 0, y: 6 } : false}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function AnimatedStar({
  children,
  ratingValue,
}: {
  children: React.ReactNode;
  ratingValue: number;
}) {
  const prevRef = useRef(ratingValue);
  const [glow, setGlow] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (prevRef.current !== ratingValue) {
      prevRef.current = ratingValue;
      if (!reduced) {
        setGlow(true);
        const t = setTimeout(() => setGlow(false), 400);
        return () => clearTimeout(t);
      }
    }
  }, [ratingValue, reduced]);

  if (reduced) {
    return <span className="inline-flex">{children}</span>;
  }

  return (
    <motion.span
      className="inline-flex"
      animate={
        glow
          ? {
              scale: [1, 1.15, 1],
              filter: ["brightness(1)", "brightness(1.3)", "brightness(1)"],
            }
          : { scale: 1, filter: "brightness(1)" }
      }
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {children}
    </motion.span>
  );
}

export function InteractiveStarRating({
  rating,
  hoveredStar,
  onRate,
  onHover,
  onLeave,
  size = 40,
}: {
  rating: number;
  hoveredStar: number;
  onRate: (star: number) => void;
  onHover: (star: number) => void;
  onLeave: () => void;
  size?: number;
}) {
  const [tappedStar, setTappedStar] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const { theme, isResolved } = useRatingTheme();

  const handleClick = useCallback(
    (star: number) => {
      onRate(star);
      if (!reduced) {
        setTappedStar(star);
        setTimeout(() => setTappedStar(null), 350);
      }
    },
    [onRate, reduced]
  );

  return (
    <div className="flex justify-center gap-2">
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= (hoveredStar || rating);
        const wasTapped = tappedStar === star;
        return (
          <motion.button
            key={star}
            type="button"
            onMouseEnter={() => onHover(star)}
            onMouseLeave={onLeave}
            onClick={() => handleClick(star)}
            className="p-1 focus:outline-none"
            animate={
              wasTapped && !reduced
                ? { scale: [1, 1.15, 1] }
                : { scale: 1 }
            }
            transition={{ duration: 0.35, ease: "easeOut" }}
            data-testid={`button-star-${star}`}
          >
            {!isResolved ? (
              <span
                className="inline-block"
                style={{ width: size, height: size }}
                aria-hidden="true"
              />
            ) : theme ? (
              <motion.span
                className="inline-flex items-center justify-center"
                style={{ width: size, height: size, fontSize: Math.round(size * 0.92), lineHeight: 1 }}
                animate={
                  wasTapped && !reduced
                    ? {
                        filter: [
                          "drop-shadow(0 0 0px rgba(250,204,21,0))",
                          "drop-shadow(0 0 8px rgba(250,204,21,0.6))",
                          "drop-shadow(0 0 0px rgba(250,204,21,0))",
                        ],
                      }
                    : {}
                }
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                {theme.iconType === "image" ? (
                  <img
                    src={theme.value}
                    alt=""
                    draggable={false}
                    style={{ width: size, height: size, objectFit: "contain" }}
                    className={`transition-all duration-200 ${active ? "" : "grayscale opacity-30"}`}
                  />
                ) : (
                  <span
                    className={`transition-all duration-200 ${active ? "" : "opacity-30"}`}
                    style={{ filter: active ? undefined : "grayscale(1)" }}
                  >
                    {theme.value}
                  </span>
                )}
              </motion.span>
            ) : (
              <motion.svg
                xmlns="http://www.w3.org/2000/svg"
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill={active ? "#facc15" : "none"}
                stroke={active ? "#facc15" : "currentColor"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-colors duration-200 ${
                  active ? "" : "text-muted-foreground/30"
                }`}
                animate={
                  wasTapped && !reduced
                    ? {
                        filter: [
                          "drop-shadow(0 0 0px rgba(250,204,21,0))",
                          "drop-shadow(0 0 8px rgba(250,204,21,0.6))",
                          "drop-shadow(0 0 0px rgba(250,204,21,0))",
                        ],
                      }
                    : {}
                }
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </motion.svg>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

export function Confetti({ show }: { show: boolean }) {
  const [particles, setParticles] = useState<
    Array<{ id: number; x: number; y: number; color: string; rotation: number; delay: number }>
  >([]);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (show && !reduced) {
      const colors = ["#facc15", "#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
      const newParticles = Array.from({ length: 24 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 30 + 10,
        color: colors[i % colors.length],
        rotation: Math.random() * 360,
        delay: Math.random() * 0.3,
      }));
      setParticles(newParticles);
      const t = setTimeout(() => setParticles([]), 800);
      return () => clearTimeout(t);
    }
  }, [show, reduced]);

  if (reduced || particles.length === 0) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[100]"
      aria-hidden="true"
    >
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{
            opacity: 1,
            x: `${p.x}vw`,
            y: "-10vh",
            rotate: 0,
            scale: 1,
          }}
          animate={{
            opacity: [1, 1, 0],
            y: `${p.y + 60}vh`,
            rotate: p.rotation,
            scale: [1, 0.8],
          }}
          transition={{
            duration: 0.8,
            delay: p.delay,
            ease: "easeOut",
          }}
          style={{
            position: "absolute",
            width: p.id % 3 === 0 ? 8 : 6,
            height: p.id % 3 === 0 ? 8 : 6,
            borderRadius: p.id % 2 === 0 ? "50%" : "1px",
            backgroundColor: p.color,
          }}
        />
      ))}
    </div>
  );
}

export function TipPulse({
  children,
  trigger,
}: {
  children: React.ReactNode;
  trigger: boolean;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div>{children}</div>;

  return (
    <motion.div
      animate={
        trigger
          ? { scale: [1, 1.06, 0.98, 1], opacity: [0.8, 1, 1, 1] }
          : { scale: 1 }
      }
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function TipConfirmPulse({
  children,
  trigger,
}: {
  children: React.ReactNode;
  trigger: boolean;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div>{children}</div>;

  return (
    <motion.div
      animate={
        trigger
          ? { scale: [1, 1.1, 1] }
          : { scale: 1 }
      }
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function TipIconFloat({
  children,
  trigger,
}: {
  children: React.ReactNode;
  trigger: boolean;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div>{children}</div>;

  return (
    <motion.div
      animate={
        trigger
          ? { y: [0, -4, 0], opacity: [1, 1, 1] }
          : { y: 0 }
      }
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function TipBadge({
  children,
  show,
}: {
  children: React.ReactNode;
  show: boolean;
}) {
  const reduced = useReducedMotion();
  if (reduced && show) return <div>{children}</div>;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function FadeIn({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function SlideUp({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
