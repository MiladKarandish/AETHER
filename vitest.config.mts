import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // mirror the "@/*" -> "./src/*" path mapping from tsconfig.json
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Next.js app: the unit-tested modules are pure, so run in plain Node.
    // Deliberately NOT jsdom — the audio/OPFS components are out of scope.
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    passWithNoTests: false,
  },
});