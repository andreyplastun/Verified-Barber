import { motion, AnimatePresence } from "framer-motion";
import { useRef, useEffect, useState } from "react";

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
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 280);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <motion.span
      className={className}
      animate={pulse ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      {value}
    </motion.span>
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

  useEffect(() => {
    if (prevRef.current !== ratingValue) {
      prevRef.current = ratingValue;
      setGlow(true);
      const t = setTimeout(() => setGlow(false), 300);
      return () => clearTimeout(t);
    }
  }, [ratingValue]);

  return (
    <motion.span
      className="inline-flex"
      animate={
        glow
          ? { filter: ["brightness(1)", "brightness(1.4)", "brightness(1)"] }
          : { filter: "brightness(1)" }
      }
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {children}
    </motion.span>
  );
}

export function TipPulse({
  children,
  trigger,
}: {
  children: React.ReactNode;
  trigger: boolean;
}) {
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

export function TipBadge({
  children,
  show,
}: {
  children: React.ReactNode;
  show: boolean;
}) {
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
