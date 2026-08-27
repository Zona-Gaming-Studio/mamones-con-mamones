/**
 * Genera el SQL del esquema de Better Auth (misma config y plugins que el
 * Worker) y lo imprime a stdout, para volcarlo en una migración de
 * `server/migrations/`:
 *
 *   bun scripts/gen-auth-schema.ts > server/migrations/0001_better_auth.sql
 *
 * ¿Por qué no `@better-auth/cli`? Quedó rezagado respecto a better-auth y
 * emitiría un esquema viejo. `better-auth/db/migration` es la misma API que
 * usaba el CLI, desde la versión exactamente instalada.
 *
 * El binding D1 es un stub que responde vacío: la introspección ve una base
 * sin tablas y emite el esquema COMPLETO. Si después cambia la versión o los
 * plugins, el diff contra este archivo es la migración nueva (las ya aplicadas
 * no se editan).
 */
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../server/auth.js";

/** D1 falsa: toda consulta devuelve cero filas (introspección de una BD vacía). */
function emptyD1(): D1Database {
  const stmt = {
    bind: () => stmt,
    all: async () => ({ results: [], success: true, meta: {} }),
    raw: async () => [],
    first: async () => null,
    run: async () => ({ results: [], success: true, meta: {} }),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

const auth = createAuth(
  {
    DB: emptyD1(),
    GOOGLE_CLIENT_ID: "cli",
    GOOGLE_CLIENT_SECRET: "cli",
  } as Env,
  "http://localhost:8787"
);

const { compileMigrations } = await getMigrations(auth.options);
const sql = await compileMigrations();
console.log(`-- Esquema de Better Auth (plugins: anonymous, bearer; emailAndPassword on).
-- GENERADO con: bun scripts/gen-auth-schema.ts  (no editar a mano — si cambia
-- la versión o los plugins, el diff va en una migración NUEVA).
`);
console.log(sql);
