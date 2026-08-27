/**
 * Verificación de sesión server-side — el equivalente funcional del RLS de
 * Supabase. Todo punto de entrada a una sala pasa por aquí: el Worker resuelve
 * la sesión, y el **id verificado se convierte en el uid del jugador**; lo que
 * el cliente declare se ignora. El Durable Object nunca re-verifica: solo es
 * alcanzable a través de este Worker y confía únicamente en `X-User-Id`.
 */
import { getAuth } from "./auth.js";

/** El header que el Worker estampa en lo que reenvía a la sala. */
export const USER_HEADER = "X-User-Id";

export interface VerifiedUser {
  id: string;
  /** Cuenta de invitado (plugin `anonymous`). Igual es un usuario real y persistido. */
  isAnonymous: boolean;
}

/**
 * Resuelve la sesión del llamante, o null si no hay. Lee tanto la cookie
 * (web same-origin) como `Authorization: Bearer` (plugin bearer). Nunca lanza:
 * un token malformado o vencido es simplemente "sin sesión".
 */
export async function verifiedUser(
  request: Request,
  env: Env,
  url: URL
): Promise<VerifiedUser | null> {
  try {
    const session = await getAuth(env, url).api.getSession({ headers: request.headers });
    if (!session?.user?.id) return null;
    return {
      id: session.user.id,
      isAnonymous: (session.user as { isAnonymous?: boolean }).isAnonymous === true,
    };
  } catch {
    return null;
  }
}

export function unauthorized(headers: Record<string, string> = {}): Response {
  return Response.json({ ok: false, error: "sesión no válida" }, { status: 401, headers });
}

/**
 * Copia una request añadiendo el header del usuario verificado. Los headers de
 * una `Request` son inmutables una vez construida, de ahí el clon (el upgrade
 * WebSocket no tiene body: clonar es barato).
 */
export function withVerifiedUser(request: Request, userId: string): Request {
  const headers = new Headers(request.headers);
  headers.set(USER_HEADER, userId);
  return new Request(request, { headers });
}

/** ¿Tiene el usuario rol de admin? (tabla `user_roles` en D1). */
export async function isAdmin(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "select 1 from user_roles where user_id = ?1 and role = 'admin'"
  )
    .bind(userId)
    .first();
  return row !== null;
}
