import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export type ReaderAuraMode = "idle" | "inspecting" | "speaking";

export type ReaderInspectionTarget = {
  id: string;
  x: number;
  y: number;
  label: "Looking here" | "Reading this page";
};

export function ReadingAura({
  mode,
  inspectionTarget,
}: {
  mode: ReaderAuraMode;
  inspectionTarget: ReaderInspectionTarget | null;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const target =
    inspectionTarget ??
    (mode === "inspecting"
      ? {
          id: "page-inspection",
          x: 0.5,
          y: 0.5,
          label: "Reading this page" as const,
        }
      : null);
  const visible = mode === "speaking" || target !== null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="reader-feedback"
          aria-hidden="true"
          className="pdf-reading-aura"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
        >
          <AnimatePresence>
            {mode === "speaking" && (
              <motion.span
                key="speaking-glow"
                className="pdf-reading-aura__speaking-glow"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.25 }}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {target && (
              <motion.span
                key={target.id}
                className="pdf-reading-aura__inspection-target"
                style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%` }}
                initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.72 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: reduceMotion ? 1 : 1.18 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.24,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <span className="pdf-reading-aura__inspection-glow" />
                <span className="pdf-reading-aura__inspection-dot" />
                <span className="pdf-reading-aura__inspection-label">
                  {target.label}
                </span>
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
