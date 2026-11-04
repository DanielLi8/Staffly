import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * Tests that need a real, seeded, DISPOSABLE Postgres in DATABASE_URL (they
 * write to it). Run with `pnpm test:db`; CI runs them in the e2e job, against
 * its throwaway database. Kept out of `pnpm test`, which needs no database.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.db.test.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
