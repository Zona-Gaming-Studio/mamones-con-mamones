import { defineConfig } from "vitest/config";

// Tests del motor de reglas (Node a secas). Los del server (Durable Object en
// workerd real) corren aparte con vitest.server.config.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.js"],
  },
});
