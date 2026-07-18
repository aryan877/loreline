import config from "@loreline/eslint-config/next";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  config,
  globalIgnores(["public/pdfjs/**"]),
]);
