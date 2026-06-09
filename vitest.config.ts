import { defineConfig } from "vitest/config";

// Unit tests for pure invariant logic (no DB / Nest container needed):
// the costing engine, Salesforce-ID rules, and FY/quarter maths.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
