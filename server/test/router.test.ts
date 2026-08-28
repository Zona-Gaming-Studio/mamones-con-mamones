import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// Integración del Worker completo (server/index.ts): rutas HTTP → SalaDO.
// La identidad es SIEMPRE la sesión de Better Auth (el stub x-mcm-uid murió
// en la Fase 4): cada test arranca con un sign-in anónimo real.

const BASE = "https://mcm.test";

async function sesion(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/sign-in/anonymous`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

function post(path: string, cookie: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return SELF.fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("router del Worker", () => {
  it("crea una sala y une a otro jugador por HTTP", async () => {
    const ana = await sesion();
    const creada = await post("/api/salas", ana, { nombre: "Ana" });
    expect(creada.status).toBe(200);
    const { ok, codigo } = (await creada.json()) as { ok: boolean; codigo: string };
    expect(ok).toBe(true);
    expect(codigo).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); // alfabeto sin O/0/I/1/L

    const beto = await sesion();
    const unida = await post(`/api/salas/${codigo}/join`, beto, { nombre: "Beto" });
    expect(unida.status).toBe(200);
    expect(((await unida.json()) as { codigo: string }).codigo).toBe(codigo);
  });

  it("exige sesión y nombre (el header x-mcm-uid ya no vale)", async () => {
    const sinSesion = await post("/api/salas", null, { nombre: "Ana" });
    expect(sinSesion.status).toBe(401);

    const conStub = await SELF.fetch(`${BASE}/api/salas`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mcm-uid": "pirata" },
      body: JSON.stringify({ nombre: "Pirata" }),
    });
    expect(conStub.status).toBe(401);

    const sinNombre = await post("/api/salas", await sesion(), {});
    expect(sinNombre.status).toBe(400);
  });

  it("unirse a un código inexistente devuelve 409 con mensaje", async () => {
    const r = await post("/api/salas/ZZZZZZ/join", await sesion(), { nombre: "Ana" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe("Sala no encontrada");
  });

  it("una ruta /api desconocida es 404", async () => {
    const r = await SELF.fetch(`${BASE}/api/nada`);
    expect(r.status).toBe(404);
  });
});
