// La única puerta al API HTTP del Worker.
//
// Dos cosas que toda llamada necesita y ninguna puede olvidar:
// - `credentials: "include"` — la sesión vive en una cookie. En dev el cliente
//   corre en :8000 y el Worker en :8787, así que la cookie solo viaja si se
//   pide explícito (el Worker ya refleja ese origen con CORS credentialed).
// - Una sola lectura del 401 — nunca significa "esta acción falló", significa
//   que la sesión murió: se avisa a la app en vez de reventar en la pantalla
//   que hizo la llamada.

// Origen del Worker. En producción el Worker sirve al propio cliente: es
// nuestro mismo origen.
export const API_BASE =
  import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? location.origin : "http://localhost:8787");

export class SessionExpiredError extends Error {
  constructor() {
    super("La sesión expiró. Vuelve a entrar.");
    this.name = "SessionExpiredError";
  }
}

let sessionLost = null;
export function onSessionExpired(handler) {
  sessionLost = handler;
  return () => {
    if (sessionLost === handler) sessionLost = null;
  };
}

export async function apiFetch(path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, { ...init, credentials: "include" });
  if (res.status === 401) {
    sessionLost?.();
    throw new SessionExpiredError();
  }
  return res;
}

// POST JSON → JSON. Lanza con el mensaje de error del servidor si !ok.
export async function apiPost(path, body) {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `error ${res.status}`);
  return json;
}

export async function apiGet(path) {
  const res = await apiFetch(path);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `error ${res.status}`);
  return json;
}
