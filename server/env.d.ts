// Secrets del Worker (wrangler secret put) — no aparecen en wrangler.jsonc,
// así que `wrangler types` no los genera; se declaran aquí por interface
// merging con el Env generado (worker-configuration.d.ts). Opcionales: en dev
// y tests pueden faltar (better-auth cae a su secret por defecto y Google se
// apaga solo).
interface Env {
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
