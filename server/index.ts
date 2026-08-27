/**
 * Worker de entrada: enruta cada request a la `SalaDO` correspondiente,
 * direccionada por el código público de la sala (`getByName`). Los assets del
 * front se sirven desde este mismo Worker (ver wrangler.jsonc); aquí solo
 * llegan /api/* y /salas/*.
 *
 * Identidad — STUB de Fase 2: el uid viene del cliente (header `x-mcm-uid` o
 * `?uid=` para el upgrade WebSocket, que no admite headers desde el browser).
 * TODO Fase 3 (Better Auth): el Worker resolverá la sesión (cookie/bearer) y
 * este canal desaparece del contrato público. El DO no cambia: ya solo confía
 * en el `X-User-Id` que estampamos aquí.
 */
import { SalaDO, USER_HEADER } from "./salaDO.js";

export { SalaDO };

// Alfabeto de códigos de sala sin caracteres ambiguos (sin O/0/I/1/L).
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RUTA_WS = /^\/salas\/([A-Za-z0-9]{4,8})\/ws$/;
const RUTA_JOIN = /^\/api\/salas\/([A-Za-z0-9]{4,8})\/join$/;

function generarCodigo(): string {
  let c = "";
  for (let i = 0; i < 6; i++) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return c;
}

function resolverUid(request: Request, url: URL): string | null {
  const uid = request.headers.get("x-mcm-uid") ?? url.searchParams.get("uid");
  return uid && /^[A-Za-z0-9_-]{1,64}$/.test(uid) ? uid : null;
}

// CORS solo para el dev del front (Vite en :8000 contra el Worker en :8787).
// En producción cliente y Worker comparten origen y esto no añade nada.
function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-mcm-uid",
  };
}

async function leerNombre(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as { nombre?: unknown } | null;
  const nombre = typeof body?.nombre === "string" ? body.nombre.trim().slice(0, 40) : "";
  return nombre || null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = cors(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Upgrade WebSocket → delegado directo a la sala, con el uid verificado
    // estampado para que la identidad del socket no sea falsificable.
    const ws = RUTA_WS.exec(url.pathname);
    if (ws) {
      const uid = resolverUid(request, url);
      if (!uid) return new Response("sesión no válida", { status: 401 });
      const conUid = new Headers(request.headers);
      conUid.set(USER_HEADER, uid);
      return env.SALA.getByName(ws[1].toUpperCase()).fetch(new Request(request, { headers: conUid }));
    }

    if (url.pathname === "/api/salas" && request.method === "POST") {
      const uid = resolverUid(request, url);
      if (!uid) return Response.json({ ok: false, error: "sesión no válida" }, { status: 401, headers });
      const nombre = await leerNombre(request);
      if (!nombre) return Response.json({ ok: false, error: "Falta el nombre" }, { status: 400, headers });

      // El código direcciona el DO: si ya existe una sala con ese nombre, el
      // propio DO rechaza (`ya-existe`) y se reintenta con otro código.
      for (let intento = 0; intento < 5; intento++) {
        const codigo = generarCodigo();
        const r = await env.SALA.getByName(codigo).crear({ codigo, uid, nombre });
        if (r.ok) return Response.json({ ok: true, codigo }, { headers });
      }
      return Response.json(
        { ok: false, error: "No se pudo crear la sala, intenta de nuevo" },
        { status: 500, headers }
      );
    }

    const join = RUTA_JOIN.exec(url.pathname);
    if (join && request.method === "POST") {
      const uid = resolverUid(request, url);
      if (!uid) return Response.json({ ok: false, error: "sesión no válida" }, { status: 401, headers });
      const nombre = await leerNombre(request);
      if (!nombre) return Response.json({ ok: false, error: "Falta el nombre" }, { status: 400, headers });

      const r = await env.SALA.getByName(join[1].toUpperCase()).unirse({ uid, nombre });
      return Response.json(r, { status: r.ok ? 200 : 409, headers });
    }

    return Response.json({ ok: false, error: "no encontrado" }, { status: 404, headers });
  },
} satisfies ExportedHandler<Env>;
