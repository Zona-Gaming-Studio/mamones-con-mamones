// Cliente de Better Auth, apuntado al mismo Worker que el netcode (reemplaza
// a Supabase Auth). `baseURL` es el ORIGEN, no la ruta: better-auth le añade
// `/api/auth` solo, que es justo donde el Worker monta su handler. La cookie
// viaja porque el fetch de better-auth ya usa `credentials: "include"`.
//
// El plugin `anonymous` hace que "jugar sin registrarse" sea una cuenta real:
// un usuario persistido con sesión, enlazable después a correo/Google sin
// perder nada. El panel admin usa las rutas de email y Google del mismo cliente.
import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { API_BASE } from "../net/api.js";

export const authClient = createAuthClient({
  baseURL: API_BASE,
  plugins: [anonymousClient()],
});

// Sesión reactiva para React: `{ data, isPending, … }`.
export const useSession = authClient.useSession;

// Garantiza una sesión: si no hay, inicia sesión anónima. Devuelve el user.
// (Misma firma conceptual que el ensureAuth de la era Supabase; respeta una
// sesión real existente — el auth del admin convive sin romper el juego.)
export async function ensureAuth() {
  const { data } = await authClient.getSession();
  if (data?.user) return data.user;
  const res = await authClient.signIn.anonymous();
  if (res.error) throw new Error(res.error.message || "No se pudo iniciar sesión");
  return res.data.user;
}
