/**
 * Better Auth montado en el Worker: usuarios y sesiones en la D1 (`DB`), rutas
 * bajo `/api/auth/*`. Reemplaza a Supabase Auth con el mismo modelo del juego:
 *
 * - Plugin `anonymous`: los jugadores entran sin registrarse (cuenta real y
 *   persistida, enlazable después a correo/Google).
 * - `emailAndPassword` + Google: el login real del panel admin (`/?admin`).
 *   Google solo se enciende si existen las credenciales (secrets
 *   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, vía `wrangler secret put`).
 * - Plugin `bearer`: token por header, para un futuro empaquetado Capacitor
 *   (webview en otro origen, sin cookies).
 *
 * El esquema de estas tablas vive en `server/migrations/0001_better_auth.sql`.
 * Si cambia la versión de better-auth o la lista de plugins, regenerarlo con
 * `bun scripts/gen-auth-schema.ts` y volcar el diff en una migración NUEVA
 * (las ya aplicadas no se editan).
 */
import { betterAuth } from "better-auth";
import { anonymous, bearer } from "better-auth/plugins";
import { D1Dialect } from "kysely-d1";

export function createAuth(env: Env, origin: string) {
  return betterAuth({
    database: { dialect: new D1Dialect({ database: env.DB }), type: "sqlite" },
    // El Worker responde en varios hosts (workers.dev prod y staging, localhost
    // en dev): el baseURL sale del origin de la request. Sin esto, better-auth
    // asume http y emite cookies SIN `Secure` aunque esté detrás de https
    // (gotcha cazado en distrito-game).
    baseURL: origin,
    // Puede faltar en dev: better-auth cae a su secret por defecto y avisa en consola.
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {},
    plugins: [anonymous(), bearer()],
    // En dev el cliente Vite corre en otro origen (:8000) que el Worker (:8787).
    // Ese origen se confía SOLO cuando el propio Worker corre en localhost.
    // Ojo: better-auth también llama esta función SIN request al armar su contexto.
    trustedOrigins: (request?: Request) =>
      request && esLocal(new URL(request.url).hostname) ? DEV_ORIGINS : [],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const DEV_ORIGINS = ["http://localhost:8000", "http://127.0.0.1:8000"];

function esLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * Instancia perezosa por isolate: armar betterAuth en cada request es trabajo
 * perdido (kysely + la tabla de rutas). Se cachea por origin y se invalida si
 * cambia `env.DB` (tests).
 */
const cache = new Map<string, Auth>();
let cacheDb: D1Database | null = null;

export function getAuth(env: Env, url: URL): Auth {
  if (cacheDb !== env.DB) {
    cache.clear();
    cacheDb = env.DB;
  }
  let auth = cache.get(url.origin);
  if (!auth) {
    auth = createAuth(env, url.origin);
    cache.set(url.origin, auth);
  }
  return auth;
}

/**
 * CORS con credenciales: el wildcard `*` no vale con cookies — se refleja el
 * origen exacto, y solo si es confiable. Solo aplica en dev (Vite :8000 →
 * Worker :8787); en producción todo es same-origin y no se añade nada.
 */
export function corsAuth(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const host = new URL(request.url).hostname;
  if (!origin || !esLocal(host) || !DEV_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    // El plugin bearer devuelve el token de sesión en este header al iniciar sesión.
    "Access-Control-Expose-Headers": "set-auth-token",
    "Vary": "Origin",
  };
}
