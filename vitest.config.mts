import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same "@/..." imports as the app (tsconfig "paths").
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    // Schedules use the phone's local time; pin one zone so results don't
    // depend on the machine running the tests. Kampala has no daylight saving.
    env: { TZ: "Africa/Kampala" },
  },
});
