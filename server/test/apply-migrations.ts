/**
 * Setup de vitest: aplica las migraciones de `server/migrations/` a la D1
 * simulada antes de los tests (el pool las inyecta como binding
 * `TEST_MIGRATIONS` — ver vitest.server.config.ts). Así los tests ejercitan
 * EXACTAMENTE el esquema que se aplica en producción, seed de cartas incluido.
 */
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
