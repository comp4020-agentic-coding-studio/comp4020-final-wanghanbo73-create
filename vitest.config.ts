import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the running app, which spec/global-setup.ts
// finds. Only spec/ runs: a test anywhere else needs adding to `include`.
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    // All spec files hit the same running app and share one SQLite-backed
    // DB (no per-test DB reset), so running files in parallel races on
    // shared rows (stock, idempotency keys, per-account limits). Running
    // them one file at a time keeps the assertions about exact stock deltas
    // and order counts deterministic.
    fileParallelism: false,
  },
});
