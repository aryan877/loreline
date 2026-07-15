import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/shared/db/schema.ts",
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
