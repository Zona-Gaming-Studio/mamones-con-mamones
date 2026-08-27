import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// Integración del Worker completo (server/index.ts): rutas HTTP → SalaDO.

function post(path: string, uid: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (uid) headers["x-mcm-uid"] = uid;
  return SELF.fetch(`https://mcm.test${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("router del Worker", () => {
  it("crea una sala y une a otro jugador por HTTP", async () => {
    const creada = await post("/api/salas", "u1", { nombre: "Ana" });
    expect(creada.status).toBe(200);
    const { ok, codigo } = (await creada.json()) as { ok: boolean; codigo: string };
    expect(ok).toBe(true);
    expect(codigo).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); // alfabeto sin O/0/I/1/L

    const unida = await post(`/api/salas/${codigo}/join`, "u2", { nombre: "Beto" });
    expect(unida.status).toBe(200);
    expect(((await unida.json()) as { codigo: string }).codigo).toBe(codigo);
  });

  it("exige identidad y nombre", async () => {
    const sinUid = await post("/api/salas", null, { nombre: "Ana" });
    expect(sinUid.status).toBe(401);
    const sinNombre = await post("/api/salas", "u1", {});
    expect(sinNombre.status).toBe(400);
  });

  it("unirse a un código inexistente devuelve 409 con mensaje", async () => {
    const r = await post("/api/salas/ZZZZZZ/join", "u1", { nombre: "Ana" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe("Sala no encontrada");
  });

  it("una ruta /api desconocida es 404", async () => {
    const r = await SELF.fetch("https://mcm.test/api/nada");
    expect(r.status).toBe(404);
  });
});
