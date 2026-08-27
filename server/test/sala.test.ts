import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

// Arma una sala con n jugadores u1..uN (u1 host) vía RPC, como hará el Worker.
async function crearSala(nombre: string, n: number) {
  const stub = env.SALA.getByName(nombre);
  const creada = await stub.crear({ codigo: nombre, uid: "u1", nombre: "Jugador 1" });
  expect(creada.ok).toBe(true);
  for (let i = 2; i <= n; i++) {
    const r = await stub.unirse({ uid: `u${i}`, nombre: `Jugador ${i}` });
    expect(r.ok).toBe(true);
  }
  return stub;
}

// Abre el WebSocket de un jugador contra el DO (como lo reenvía el Worker,
// con la identidad ya estampada) y acumula los mensajes recibidos.
async function abrirWS(stub: ReturnType<typeof env.SALA.getByName>, uid: string) {
  const res = await stub.fetch(
    new Request("https://sala/ws", {
      headers: { Upgrade: "websocket", "X-User-Id": uid },
    })
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const mensajes: Record<string, unknown>[] = [];
  ws.addEventListener("message", (e) => mensajes.push(JSON.parse(e.data as string)));
  const ultimo = (t: string) => mensajes.filter((m) => m.t === t).at(-1) as any;
  return { ws, mensajes, ultimo };
}

describe("SalaDO — creación y lobby", () => {
  it("crea la sala, une jugadores y rechaza códigos duplicados", async () => {
    const stub = await crearSala("LOBBY1", 4);
    const dup = await stub.crear({ codigo: "LOBBY1", uid: "u9", nombre: "Pirata" });
    expect(dup.ok).toBe(false);
    expect(dup.error).toBe("ya-existe");

    const snap = await stub.snapshotRpc("u1");
    expect(snap!.sala.fase).toBe("lobby");
    expect(snap!.sala.hostUid).toBe("u1");
    expect(snap!.jugadores).toHaveLength(4);
  });

  it("unirse a una sala inexistente falla", async () => {
    const r = await env.SALA.getByName("NOEXISTE").unirse({ uid: "u1", nombre: "Nadie" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Sala no encontrada");
  });

  it("tras iniciar: nadie nuevo entra, pero un miembro puede volver", async () => {
    const stub = await crearSala("CERRADA", 4);
    const inicio = await stub.accionRpc("u1", { tipo: "iniciar" });
    expect(inicio.ok).toBe(true);

    const tarde = await stub.unirse({ uid: "u9", nombre: "Tarde" });
    expect(tarde.ok).toBe(false);
    expect(tarde.error).toBe("La partida ya empezó");

    const vuelve = await stub.unirse({ uid: "u3", nombre: "Jugador 3" });
    expect(vuelve.ok).toBe(true);
  });
});

describe("SalaDO — partida por RPC", () => {
  it("iniciar reparte manos del mazo real y arranca el reloj", async () => {
    const stub = await crearSala("RONDA1", 4);
    const noHost = await stub.accionRpc("u2", { tipo: "iniciar" });
    expect(noHost.ok).toBe(false);
    expect(noHost.error).toBe("Solo el host puede iniciar");

    await stub.accionRpc("u1", { tipo: "iniciar" });
    const snap = await stub.snapshotRpc("u2");
    expect(snap!.sala.fase).toBe("jugando");
    expect(snap!.sala.ronda).toBe(1);
    expect(snap!.mano).toHaveLength(7); // del cartas.json empaquetado (897 rojas)
    expect(snap!.sala.cartaVerde).toBeTruthy();

    // La alarm del DO ES el deadline de la fase.
    const alarm = await stub.alarmProgramadaRpc();
    expect(alarm).toBe(snap!.sala.faseHasta);
  });

  it("la alarm resuelve el timeout: ronda saltada sin jugadas", async () => {
    const stub = await crearSala("TIMEOUT", 4);
    await stub.accionRpc("u1", { tipo: "iniciar" });

    await stub.adelantarRelojRpc(61_000);
    const corrio = await runDurableObjectAlarm(stub);
    expect(corrio).toBe(true);

    const snap = await stub.snapshotRpc("u1");
    expect(snap!.sala.ronda).toBe(2); // 0 jugadas → se saltó la ronda
    expect(snap!.sala.fase).toBe("jugando");
    const alarm = await stub.alarmProgramadaRpc();
    expect(alarm).toBe(snap!.sala.faseHasta); // re-armada para la ronda nueva
  });
});

describe("SalaDO — WebSocket", () => {
  it("rechaza upgrades sin identidad o de extraños", async () => {
    const stub = await crearSala("WSGUARD", 4);
    const sinUid = await stub.fetch(
      new Request("https://sala/ws", { headers: { Upgrade: "websocket" } })
    );
    expect(sinUid.status).toBe(401);
    const extrano = await stub.fetch(
      new Request("https://sala/ws", {
        headers: { Upgrade: "websocket", "X-User-Id": "u99" },
      })
    );
    expect(extrano.status).toBe(403);
  });

  it("difunde snapshots censurados por jugador tras cada acción", async () => {
    const stub = await crearSala("WSFLOW", 4);
    const u1 = await abrirWS(stub, "u1");
    const u2 = await abrirWS(stub, "u2");

    // Al conectar llega el snapshot inicial (lobby).
    await vi.waitFor(() => expect(u2.ultimo("snapshot")).toBeTruthy());
    expect(u2.ultimo("snapshot").sala.fase).toBe("lobby");

    // El host inicia por WS; todos reciben el snapshot de la ronda 1.
    u1.ws.send(JSON.stringify({ t: "iniciar" }));
    await vi.waitFor(() => {
      expect(u1.ultimo("snapshot")?.sala.fase).toBe("jugando");
      expect(u2.ultimo("snapshot")?.sala.fase).toBe("jugando");
    });

    // Un no-Juez juega una carta de SU snapshot; la difusión censura al resto.
    const juez = u1.ultimo("snapshot").sala.juezUid;
    const jugadorWS = juez === "u1" ? u2 : u1;
    const otroWS = juez === "u1" ? u1 : u2;
    const uidJugador = juez === "u1" ? "u2" : "u1";
    const carta = jugadorWS.ultimo("snapshot").mano[0];
    jugadorWS.ws.send(JSON.stringify({ t: "jugar_carta", carta }));

    await vi.waitFor(() => {
      expect(jugadorWS.ultimo("snapshot").jugaron).toContain(uidJugador);
    });
    expect(jugadorWS.ultimo("snapshot").mano).not.toContain(carta);
    expect(jugadorWS.ultimo("snapshot").misJugadas[0].carta).toBe(carta);
    const mesaAjena = otroWS.ultimo("snapshot").mesa;
    expect(mesaAjena).toHaveLength(1);
    expect(mesaAjena[0].carta).toBeNull(); // censura en fase 'jugando'
    expect(mesaAjena[0].jugadorUid).toBeNull();
  });

  it("una validación rechazada vuelve como {t:'error'} solo a quien la envió", async () => {
    const stub = await crearSala("WSERR", 4);
    const u1 = await abrirWS(stub, "u1");
    await vi.waitFor(() => expect(u1.ultimo("snapshot")).toBeTruthy());

    u1.ws.send(JSON.stringify({ t: "jugar_carta", carta: "X" }));
    await vi.waitFor(() => expect(u1.ultimo("error")).toBeTruthy());
    expect(u1.ultimo("error").mensaje).toBe("No es momento de jugar");
  });

  it("chat y reacciones se relayan con el uid del emisor, sin persistir", async () => {
    const stub = await crearSala("WSCHAT", 4);
    const u1 = await abrirWS(stub, "u1");
    const u2 = await abrirWS(stub, "u2");
    await vi.waitFor(() => expect(u2.ultimo("snapshot")).toBeTruthy());

    u1.ws.send(JSON.stringify({ t: "chat", nombre: "Jugador 1", texto: "¡épale!" }));
    await vi.waitFor(() => expect(u2.ultimo("chat")).toBeTruthy());
    expect(u2.ultimo("chat")).toMatchObject({ uid: "u1", texto: "¡épale!" });
  });

  it("cerrar el socket marca la desconexión (y la reconexión la revierte)", async () => {
    const stub = await crearSala("WSDESC", 4);
    const u2 = await abrirWS(stub, "u2");
    await vi.waitFor(() => expect(u2.ultimo("snapshot")).toBeTruthy());

    u2.ws.close(1000, "me voy");
    await vi.waitFor(async () => {
      const snap = await stub.snapshotRpc("u1");
      expect(snap!.jugadores.find((j: any) => j.uid === "u2")!.conectado).toBe(false);
    });

    await abrirWS(stub, "u2");
    await vi.waitFor(async () => {
      const snap = await stub.snapshotRpc("u1");
      expect(snap!.jugadores.find((j: any) => j.uid === "u2")!.conectado).toBe(true);
    });
  });

  it("abandonar saca al jugador y con la sala vacía se borra todo", async () => {
    const stub = await crearSala("WSBYE", 2);
    const u1 = await abrirWS(stub, "u1");
    const u2 = await abrirWS(stub, "u2");
    await vi.waitFor(() => expect(u1.ultimo("snapshot")).toBeTruthy());

    u2.ws.send(JSON.stringify({ t: "abandonar" }));
    await vi.waitFor(async () => {
      const snap = await stub.snapshotRpc("u1");
      expect(snap!.jugadores.map((j: any) => j.uid)).toEqual(["u1"]);
    });

    u1.ws.send(JSON.stringify({ t: "abandonar" }));
    await vi.waitFor(async () => {
      expect(await stub.snapshotRpc("u1")).toBeNull();
    });
    expect(await stub.alarmProgramadaRpc()).toBeNull();
  });
});
