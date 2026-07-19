import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export type ReaderAuraMode = "idle" | "listening" | "inspecting" | "speaking";

export function ReadingAura({ mode }: { mode: ReaderAuraMode }) {
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <AnimatePresence>
      {mode !== "idle" && (
        <motion.div
          key={mode}
          data-reading-aura={mode}
          aria-hidden="true"
          className="pdf-reading-aura"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.45, ease: "easeOut" }}
        >
          {!reduceMotion && (
            <>
              {mode === "listening" && (
                <span className="pdf-reading-aura__listening" />
              )}
              {mode === "inspecting" && (
                <span className="pdf-reading-aura__inspection" />
              )}
              {mode === "speaking" && (
                <>
                  <span className="pdf-reading-aura__orbit" />
                  <span className="pdf-reading-aura__sweep" />
                </>
              )}
            </>
          )}
          <span className="pdf-reading-aura__edge" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
