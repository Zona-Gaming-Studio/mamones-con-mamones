import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Tests del Worker + SalaDO sobre workerd real (@cloudflare/vitest-pool-workers,
 * API de vitest 4: el pool se monta como plugin `cloudflareTest`).
 *
 * Las migraciones D1 (server/migrations/) se leen aquí (contexto Node) y se
 * pasan como binding para que el setup las aplique a la D1 simulada ANTES de
 * cada corrida — el mismo esquema que producción, sin duplicarlo.
 *
 * ⚠️ El pool arranca leyendo wrangler.jsonc, que declara `assets.directory:
 * ./dist` — wrangler exige que la carpeta EXISTA al parsear la config aunque
 * los tests no usen un solo asset. En un clone limpio no hay dist/ y los tests
 * reventarían antes de empezar: el script `pretest` de package.json la crea.
 * (Gotcha heredado de distrito-game.)
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations("server/migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      include: ["server/test/**/*.test.ts"],
      setupFiles: ["./server/test/apply-migrations.ts"],
    },
  };
});
