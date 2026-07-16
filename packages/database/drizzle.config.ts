import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: "../../.env", quiet: true });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://loreline:loreline@localhost:5432/loreline",
  },
  strict: true,
  verbose: true,
});
