import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

const BASE = "https://mcm.test";

function cookieDe(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

function post(path: string, body: unknown, cookie = "") {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function get(path: string, cookie = "") {
  return SELF.fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
}

async function sesionAnonima(): Promise<{ cookie: string; userId: string }> {
  const res = await post("/api/auth/sign-in/anonymous", {});
  expect(res.status).toBe(200);
  const { user } = (await res.json()) as { user: { id: string } };
  return { cookie: cookieDe(res), userId: user.id };
}

async function sesionEmail(email: string): Promise<{ cookie: string; userId: string }> {
  const res = await post("/api/auth/sign-up/email", {
    email,
    password: "clave-segura-123",
    name: "Admin de Prueba",
  });
  expect(res.status).toBe(200);
  const { user } = (await res.json()) as { user: { id: string } };
  return { cookie: cookieDe(res), userId: user.id };
}

describe("auth — sesiones", () => {
  it("el login anónimo emite sesión y con la cookie se crea una sala (sin stub)", async () => {
    const ana = await sesionAnonima();
    const beto = await sesionAnonima();
    expect(ana.userId).not.toBe(beto.userId);

    const creada = await post("/api/salas", { nombre: "Ana" }, ana.cookie);
    expect(creada.status).toBe(200);
    const { codigo } = (await creada.json()) as { codigo: string };

    const unido = await post(`/api/salas/${codigo}/join`, { nombre: "Beto" }, beto.cookie);
    expect(unido.status).toBe(200);
  });

  it("sin sesión ni stub: 401", async () => {
    const r = await post("/api/salas", { nombre: "Nadie" });
    expect(r.status).toBe(401);
  });

  it("/api/config reporta si Google está disponible", async () => {
    const r = await get("/api/config");
    expect(((await r.json()) as { googleEnabled: boolean }).googleEnabled).toBe(false);
  });
});

describe("catálogo de cartas (D1 con el seed aplicado)", () => {
  it("expone las 1047 activas con su flavor", async () => {
    const r = await get("/api/cartas");
    expect(r.status).toBe(200);
    const { cartas } = (await r.json()) as { cartas: { texto: string; flavor: string }[] };
    expect(cartas).toHaveLength(1047);
    expect(cartas.every((c) => c.texto)).toBe(true);
  });
});

describe("panel admin", () => {
  it("exige sesión real con rol admin (los anónimos no cuentan, ni con rol)", async () => {
    expect((await get("/api/admin/cartas")).status).toBe(401);

    const anon = await sesionAnonima();
    await env.DB.prepare("insert into user_roles (user_id, role) values (?1, 'admin')")
      .bind(anon.userId)
      .run();
    expect((await get("/api/admin/cartas", anon.cookie)).status).toBe(403);

    const admin = await sesionEmail("admin@mcm.test");
    expect((await get("/api/admin/cartas", admin.cookie)).status).toBe(403); // sin rol aún

    await env.DB.prepare("insert into user_roles (user_id, role) values (?1, 'admin')")
      .bind(admin.userId)
      .run();
    const r = await get("/api/admin/cartas", admin.cookie);
    expect(r.status).toBe(200);
    const { cartas } = (await r.json()) as { cartas: unknown[] };
    expect(cartas).toHaveLength(1047);
  });

  it("CRUD completo: crear, editar, desactivar, upsert CSV y borrar", async () => {
    const admin = await sesionEmail("crud@mcm.test");
    await env.DB.prepare("insert into user_roles (user_id, role) values (?1, 'admin')")
      .bind(admin.userId)
      .run();

    // Crear.
    const creada = await post(
      "/api/admin/cartas",
      { color: "roja", tipo: "Prueba", texto: "La carta de prueba", flavor: "jeje" },
      admin.cookie
    );
    expect(creada.status).toBe(200);
    const { id } = (await creada.json()) as { id: number };

    // Duplicado por (color, texto) → 409.
    const dup = await post(
      "/api/admin/cartas",
      { color: "roja", texto: "La carta de prueba" },
      admin.cookie
    );
    expect(dup.status).toBe(409);

    // Editar (desactivar): deja de salir en el catálogo público.
    const antes = ((await (await get("/api/cartas")).json()) as { cartas: unknown[] }).cartas.length;
    const editada = await SELF.fetch(`${BASE}/api/admin/cartas/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin.cookie },
      body: JSON.stringify({ color: "roja", tipo: "Prueba", texto: "La carta de prueba", flavor: "jeje", activa: false }),
    });
    expect(editada.status).toBe(200);
    const despues = ((await (await get("/api/cartas")).json()) as { cartas: unknown[] }).cartas.length;
    expect(despues).toBe(antes - 1);

    // Upsert (import CSV): actualiza flavor y reactiva por (color, texto).
    const upsert = await post(
      "/api/admin/cartas/upsert",
      { cartas: [{ color: "roja", texto: "La carta de prueba", flavor: "actualizado", activa: true }] },
      admin.cookie
    );
    expect(((await upsert.json()) as { cantidad: number }).cantidad).toBe(1);
    const fila = await env.DB.prepare("select flavor, activa from cartas where id = ?1").bind(id).first();
    expect(fila).toMatchObject({ flavor: "actualizado", activa: 1 });

    // Borrar.
    const borrada = await SELF.fetch(`${BASE}/api/admin/cartas/${id}`, {
      method: "DELETE",
      headers: { cookie: admin.cookie },
    });
    expect(borrada.status).toBe(200);
    expect(await env.DB.prepare("select 1 from cartas where id = ?1").bind(id).first()).toBeNull();
  });
});
