import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import base from "./base.mjs";

export default defineConfig([
  ...base,
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "next-env.d.ts", "out/**"]),
]);
