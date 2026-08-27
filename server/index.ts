/**
 * Worker de entrada: auth (Better Auth sobre D1), catálogo/admin de cartas
 * (D1) y el enrutado de cada sala a su `SalaDO` (direccionada por el código
 * público con `getByName`). Los assets del front se sirven desde este mismo
 * Worker (ver wrangler.jsonc); aquí solo llegan /api/* y /salas/*.
 *
 * Identidad: la sesión de Better Auth manda (cookie o bearer). El stub de la
 * Fase 2 (`x-mcm-uid` / `?uid=`) sobrevive como fallback SOLO mientras el
 * cliente React sigue en Supabase — TODO Fase 4: eliminar `uidStub`.
 */
import { SalaDO } from "./salaDO.js";
import { corsAuth, getAuth } from "./auth.js";
import { USER_HEADER, isAdmin, unauthorized, verifiedUser } from "./session.js";

export { SalaDO };

// Alfabeto de códigos de sala sin caracteres ambiguos (sin O/0/I/1/L).
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RUTA_WS = /^\/salas\/([A-Za-z0-9]{4,8})\/ws$/;
const RUTA_JOIN = /^\/api\/salas\/([A-Za-z0-9]{4,8})\/join$/;
const RUTA_ADMIN_CARTA = /^\/api\/admin\/cartas\/(\d+)$/;

function generarCodigo(): string {
  let c = "";
  for (let i = 0; i < 6; i++) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return c;
}

function uidStub(request: Request, url: URL): string | null {
  const uid = request.headers.get("x-mcm-uid") ?? url.searchParams.get("uid");
  return uid && /^[A-Za-z0-9_-]{1,64}$/.test(uid) ? uid : null;
}

async function resolverUid(request: Request, env: Env, url: URL): Promise<string | null> {
  const user = await verifiedUser(request, env, url);
  return user?.id ?? uidStub(request, url);
}

async function leerNombre(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as { nombre?: unknown } | null;
  const nombre = typeof body?.nombre === "string" ? body.nombre.trim().slice(0, 40) : "";
  return nombre || null;
}

type CartaBody = {
  color?: unknown;
  tipo?: unknown;
  texto?: unknown;
  flavor?: unknown;
  activa?: unknown;
};

function validarCarta(c: CartaBody): { color: string; tipo: string | null; texto: string; flavor: string | null; activa: number } | null {
  const color = c.color === "verde" || c.color === "roja" ? c.color : null;
  const texto = typeof c.texto === "string" ? c.texto.trim() : "";
  if (!color || !texto) return null;
  return {
    color,
    tipo: typeof c.tipo === "string" && c.tipo.trim() ? c.tipo.trim() : null,
    texto,
    flavor: typeof c.flavor === "string" && c.flavor.trim() ? c.flavor.trim() : null,
    activa: c.activa === false || c.activa === 0 ? 0 : 1,
  };
}

/** CRUD del catálogo para el panel `/?admin` (reemplaza RLS + tabla Supabase). */
async function handleAdmin(
  request: Request,
  env: Env,
  url: URL,
  headers: Record<string, string>
): Promise<Response> {
  const user = await verifiedUser(request, env, url);
  if (!user) return unauthorized(headers);
  if (user.isAnonymous || !(await isAdmin(env, user.id))) {
    return Response.json({ ok: false, error: "sin permiso" }, { status: 403, headers });
  }

  if (url.pathname === "/api/admin/cartas" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "select id, color, tipo, texto, flavor, activa from cartas order by id"
    ).all();
    const cartas = results.map((r) => ({ ...r, activa: Boolean(r.activa) }));
    return Response.json({ ok: true, cartas }, { headers });
  }

  if (url.pathname === "/api/admin/cartas" && request.method === "POST") {
    const carta = validarCarta((await request.json().catch(() => ({}))) as CartaBody);
    if (!carta) return Response.json({ ok: false, error: "Carta inválida" }, { status: 400, headers });
    try {
      const r = await env.DB.prepare(
        "insert into cartas (color, tipo, texto, flavor, activa) values (?1, ?2, ?3, ?4, ?5)"
      )
        .bind(carta.color, carta.tipo, carta.texto, carta.flavor, carta.activa)
        .run();
      return Response.json({ ok: true, id: r.meta.last_row_id }, { headers });
    } catch {
      return Response.json({ ok: false, error: "Ya existe una carta con ese texto" }, { status: 409, headers });
    }
  }

  // Import CSV: upsert masivo por (color, texto) — el mismo contrato que tenía
  // el upsert de Supabase en Admin.jsx.
  if (url.pathname === "/api/admin/cartas/upsert" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { cartas?: CartaBody[] } | null;
    const filas = (body?.cartas ?? []).map(validarCarta).filter((c) => c !== null);
    if (!filas.length) return Response.json({ ok: false, error: "Sin cartas válidas" }, { status: 400, headers });
    const stmt = env.DB.prepare(
      `insert into cartas (color, tipo, texto, flavor, activa) values (?1, ?2, ?3, ?4, ?5)
       on conflict (color, texto) do update
         set tipo = excluded.tipo, flavor = excluded.flavor, activa = excluded.activa`
    );
    await env.DB.batch(filas.map((c) => stmt.bind(c.color, c.tipo, c.texto, c.flavor, c.activa)));
    return Response.json({ ok: true, cantidad: filas.length }, { headers });
  }

  const porId = RUTA_ADMIN_CARTA.exec(url.pathname);
  if (porId && request.method === "PUT") {
    const carta = validarCarta((await request.json().catch(() => ({}))) as CartaBody);
    if (!carta) return Response.json({ ok: false, error: "Carta inválida" }, { status: 400, headers });
    await env.DB.prepare(
      "update cartas set color = ?1, tipo = ?2, texto = ?3, flavor = ?4, activa = ?5 where id = ?6"
    )
      .bind(carta.color, carta.tipo, carta.texto, carta.flavor, carta.activa, porId[1])
      .run();
    return Response.json({ ok: true }, { headers });
  }
  if (porId && request.method === "DELETE") {
    await env.DB.prepare("delete from cartas where id = ?1").bind(porId[1]).run();
    return Response.json({ ok: true }, { headers });
  }

  return Response.json({ ok: false, error: "no encontrado" }, { status: 404, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = corsAuth(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Auth (Better Auth sobre D1).
    if (url.pathname.startsWith("/api/auth/")) {
      const res = await getAuth(env, url).handler(request);
      if (Object.keys(headers).length === 0) return res;
      const conCors = new Response(res.body, res);
      for (const [k, v] of Object.entries(headers)) conCors.headers.set(k, v);
      return conCors;
    }

    // Config pública: lo que la pantalla de login necesita antes de tener sesión.
    if (url.pathname === "/api/config") {
      return Response.json(
        { googleEnabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) },
        { headers }
      );
    }

    // Catálogo público: texto → flavor de las cartas activas (lo usa el tablero
    // para el long-press; reemplaza el fetch de `cartas` vía supabase-js).
    if (url.pathname === "/api/cartas" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "select texto, flavor from cartas where activa = 1"
      ).all();
      return Response.json({ ok: true, cartas: results }, { headers });
    }

    if (url.pathname.startsWith("/api/admin/")) {
      return handleAdmin(request, env, url, headers);
    }

    // Upgrade WebSocket → delegado directo a la sala, con el uid verificado
    // estampado para que la identidad del socket no sea falsificable.
    const ws = RUTA_WS.exec(url.pathname);
    if (ws) {
      const uid = await resolverUid(request, env, url);
      if (!uid) return new Response("sesión no válida", { status: 401 });
      const conUid = new Headers(request.headers);
      conUid.set(USER_HEADER, uid);
      return env.SALA.getByName(ws[1].toUpperCase()).fetch(new Request(request, { headers: conUid }));
    }

    if (url.pathname === "/api/salas" && request.method === "POST") {
      const uid = await resolverUid(request, env, url);
      if (!uid) return unauthorized(headers);
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
      const uid = await resolverUid(request, env, url);
      if (!uid) return unauthorized(headers);
      const nombre = await leerNombre(request);
      if (!nombre) return Response.json({ ok: false, error: "Falta el nombre" }, { status: 400, headers });

      const r = await env.SALA.getByName(join[1].toUpperCase()).unirse({ uid, nombre });
      return Response.json(r, { status: r.ok ? 200 : 409, headers });
    }

    return Response.json({ ok: false, error: "no encontrado" }, { status: 404, headers });
  },
} satisfies ExportedHandler<Env>;
