import { describe, expect, it } from "vitest";
import {
  elegirGanadora,
  jugador,
  jugarCarta,
  marcarConexion,
  metaGanar,
  siguienteRonda,
} from "./index.js";
import {
  jugadasDe,
  jugarTodos,
  mazoTest,
  noJueces,
  partidaIniciada,
} from "./test-utils.js";

describe("jugarCarta", () => {
  it("valida fase, rol, membresía, posesión y cupo de jugadas", () => {
    const { estado, ctx } = partidaIniciada(4);
    const [j1] = noJueces(estado);
    expect(() => jugarCarta(estado, estado.juezUid, "R1", ctx)).toThrow(
      "El Juez no juega carta"
    );
    expect(() => jugarCarta(estado, "fantasma", "R1", ctx)).toThrow("No estás en la sala");
    expect(() => jugarCarta(estado, j1.uid, "NO-EXISTE", ctx)).toThrow(
      "No tienes esa carta"
    );

    const carta = estado.manos[j1.uid][0];
    jugarCarta(estado, j1.uid, carta, ctx);
    expect(estado.manos[j1.uid]).not.toContain(carta);
    expect(jugadasDe(estado, j1.uid)).toHaveLength(1);
    expect(() => jugarCarta(estado, j1.uid, estado.manos[j1.uid][0], ctx)).toThrow(
      "Ya jugaste tus cartas"
    );
  });

  it("cierra a 'juzgando' cuando juegan todos los que debían", () => {
    const { estado, ctx } = partidaIniciada(4);
    jugarTodos(estado, ctx);
    expect(estado.fase).toBe("juzgando");
    expect(estado.faseHasta).toBe(ctx.now() + 60_000);
    expect(estado.mesa).toHaveLength(3);
  });

  it("no cierra prematuro si un desconectado ya había jugado", () => {
    const { estado, ctx } = partidaIniciada(5);
    const [a, b, c] = noJueces(estado); // 4 no-jueces
    jugarCarta(estado, a.uid, estado.manos[a.uid][0], ctx);
    marcarConexion(estado, a.uid, false, ctx);
    // Quedan 3 conectados no-Juez esperados; la jugada del desconectado no cuenta.
    jugarCarta(estado, b.uid, estado.manos[b.uid][0], ctx);
    jugarCarta(estado, c.uid, estado.manos[c.uid][0], ctx);
    expect(estado.fase).toBe("jugando");
  });
});

describe("ciclo de ronda clásico", () => {
  it("el Juez premia, se anota historial y se avanza rotando el Juez", () => {
    const { estado, ctx } = partidaIniciada(4);
    const juezAnterior = estado.juezUid;
    jugarTodos(estado, ctx);

    const jugada = estado.mesa[0];
    elegirGanadora(estado, estado.juezUid, jugada.id, ctx);
    expect(estado.fase).toBe("resultado");
    expect(estado.faseHasta).toBe(ctx.now() + 25_000);
    expect(jugada.esGanadora).toBe(true);
    expect(jugador(estado, jugada.jugadorUid).puntos).toBe(1);
    expect(estado.historial).toEqual([
      {
        ronda: 1,
        verde: estado.cartaVerde,
        roja: jugada.carta,
        ganadorUid: jugada.jugadorUid,
        ganador: jugador(estado, jugada.jugadorUid).nombre,
      },
    ]);

    siguienteRonda(estado, estado.hostUid, ctx);
    expect(estado.ronda).toBe(2);
    expect(estado.fase).toBe("jugando");
    expect(estado.mesa).toHaveLength(0);
    // Rotación por orden: el siguiente conectado con orden mayor (envolvente).
    const ordenes = estado.jugadores.slice().sort((a, b) => a.orden - b.orden);
    const idx = ordenes.findIndex((j) => j.uid === juezAnterior);
    expect(estado.juezUid).toBe(ordenes[(idx + 1) % ordenes.length].uid);
    // Todas las manos repuestas a 7.
    for (const j of estado.jugadores) expect(estado.manos[j.uid]).toHaveLength(7);
  });

  it("la rotación del Juez salta a los desconectados", () => {
    const { estado, ctx } = partidaIniciada(5);
    const ordenes = estado.jugadores.slice().sort((a, b) => a.orden - b.orden);
    const idx = ordenes.findIndex((j) => j.uid === estado.juezUid);
    const siguiente = ordenes[(idx + 1) % ordenes.length];
    const subsiguiente = ordenes[(idx + 2) % ordenes.length];
    siguiente.conectado = false;

    jugarTodos(estado, ctx);
    elegirGanadora(estado, estado.juezUid, estado.mesa[0].id, ctx);
    siguienteRonda(estado, estado.hostUid, ctx);
    expect(estado.juezUid).toBe(subsiguiente.uid);
  });

  it("solo host o Juez avanzan desde resultado", () => {
    const { estado, ctx } = partidaIniciada(4);
    jugarTodos(estado, ctx);
    expect(() => siguienteRonda(estado, estado.hostUid, ctx)).toThrow(
      "Aún no termina la ronda"
    );
    elegirGanadora(estado, estado.juezUid, estado.mesa[0].id, ctx);
    const ni = estado.jugadores.find(
      (j) => j.uid !== estado.hostUid && j.uid !== estado.juezUid
    );
    expect(() => siguienteRonda(estado, ni.uid, ctx)).toThrow(
      "Solo el host o el Juez avanzan"
    );
  });

  it("alcanzar la meta termina la partida", () => {
    const { estado, ctx } = partidaIniciada(4, { config: { meta: 2 } });
    expect(metaGanar(estado)).toBe(2);
    let vueltas = 0;
    while (estado.fase !== "terminado" && vueltas++ < 10) {
      jugarTodos(estado, ctx);
      // Premiar siempre al mismo (u2 si no es juez; si lo es, a u3).
      const objetivo = estado.juezUid === "u2" ? "u3" : "u2";
      const jugada = jugadasDe(estado, objetivo)[0];
      elegirGanadora(estado, estado.juezUid, jugada.id, ctx);
      if (estado.fase === "resultado") siguienteRonda(estado, estado.hostUid, ctx);
    }
    expect(estado.fase).toBe("terminado");
    expect(estado.faseHasta).toBeNull();
    const puntosMax = Math.max(...estado.jugadores.map((j) => j.puntos));
    expect(puntosMax).toBe(2);
    expect(estado.historial.length).toBeGreaterThanOrEqual(2);
  });
});

describe("descarte de rojas", () => {
  it("las cartas jugadas no vuelven a repartirse en la partida", () => {
    const { estado, ctx } = partidaIniciada(4);
    for (let r = 0; r < 5; r++) {
      jugarTodos(estado, ctx);
      const jugadasAhora = estado.mesa.map((m) => m.carta);
      elegirGanadora(estado, estado.juezUid, estado.mesa[0].id, ctx);
      if (estado.fase === "terminado") break;
      siguienteRonda(estado, estado.hostUid, ctx);
      expect(estado.descarteRojas).toEqual(expect.arrayContaining(jugadasAhora));
      // Las repuestas nunca son cartas ya quemadas.
      const descartadas = new Set(estado.descarteRojas);
      for (const c of Object.values(estado.manos).flat()) {
        expect(descartadas.has(c)).toBe(false);
      }
    }
  });

  it("recicla el descarte cuando el mazo activo se agota, sin duplicar manos", () => {
    // Mazo justo: 4 manos de 7 + 3 de margen → se agota enseguida.
    const { estado, ctx } = partidaIniciada(4, { mazo: mazoTest(31, 12) });
    for (let r = 0; r < 8 && estado.fase !== "terminado"; r++) {
      jugarTodos(estado, ctx);
      elegirGanadora(estado, estado.juezUid, estado.mesa[0].id, ctx);
      if (estado.fase === "terminado") break;
      siguienteRonda(estado, estado.hostUid, ctx);
      const todas = Object.values(estado.manos).flat();
      expect(new Set(todas).size).toBe(todas.length); // invariante duro
      for (const j of estado.jugadores) expect(estado.manos[j.uid]).toHaveLength(7);
    }
  });
});
