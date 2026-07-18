import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

const monorepoRoot = path.join(import.meta.dirname, "../..");
loadEnvConfig(monorepoRoot);

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  poweredByHeader: false,
};

export default nextConfig;
