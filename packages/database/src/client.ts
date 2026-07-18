import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { lorelinePool?: Pool };

export const pool =
  globalForDb.lorelinePool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://loreline:loreline@localhost:5432/loreline",
    max: process.env.NODE_ENV === "production" ? 10 : 4,
  });

if (process.env.NODE_ENV !== "production") globalForDb.lorelinePool = pool;

export const db = drizzle(pool, { schema });
