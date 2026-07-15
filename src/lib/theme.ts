export const theme = {
  motion: {
    fast: 0.15,
    base: 0.3,
    slow: 0.8,
    revealEase: [0.16, 1, 0.3, 1] as const,
    spring: { type: "spring", stiffness: 360, damping: 30 } as const,
  },
  layout: {
    maxWidth: "80rem",
    readerSideboard: "23rem",
  },
} as const;
