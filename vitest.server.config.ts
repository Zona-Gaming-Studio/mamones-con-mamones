import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Tests del Worker + SalaDO sobre workerd real (@cloudflare/vitest-pool-workers,
 * API de vitest 4: el pool se monta como plugin `cloudflareTest`).
 *
 * ⚠️ El pool arranca leyendo wrangler.jsonc, que declara `assets.directory:
 * ./dist` — wrangler exige que la carpeta EXISTA al parsear la config aunque
 * los tests no usen un solo asset. En un clone limpio no hay dist/ y los tests
 * reventarían antes de empezar: el script `pretest` de package.json la crea.
 * (Gotcha heredado de distrito-game.)
 */
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    include: ["server/test/**/*.test.ts"],
  },
});
