import { describe, expect, it } from "vitest";
import { elegirGanadora, jugador, jugarCarta, snapshotPara } from "./index.js";
import { jugarTodos, noJueces, partidaIniciada } from "./test-utils.js";

describe("snapshotPara (censura por fase y rol)", () => {
  it("en 'jugando': la mesa no revela cartas ni autores, la mano es solo propia", () => {
    const { estado, ctx } = partidaIniciada(4);
    const [a, b] = noJueces(estado);
    jugarCarta(estado, a.uid, estado.manos[a.uid][0], ctx);

    const deB = snapshotPara(estado, b.uid);
    expect(deB.mesa).toHaveLength(1);
    expect(deB.mesa[0].carta).toBeNull();
    expect(deB.mesa[0].jugadorUid).toBeNull();
    expect(deB.mesa[0].nombre).toBeNull();
    expect(deB.jugaron).toEqual([a.uid]); // el "✓ jugó" sí se ve
    expect(deB.mano).toEqual(estado.manos[b.uid]);
    expect(deB.misJugadas).toEqual([]);

    // El que jugó ve su propia jugada completa.
    const deA = snapshotPara(estado, a.uid);
    expect(deA.misJugadas).toHaveLength(1);
    expect(deA.misJugadas[0].carta).toBeTruthy();

    // Nadie ve manos ajenas ni el estado interno de los mazos.
    for (const carta of estado.manos[a.uid]) {
      expect(JSON.stringify(deB)).not.toContain(JSON.stringify(carta));
    }
    expect(deB.sala.mazo).toBeUndefined();
  });

  it("en 'juzgando': cartas visibles y anónimas, con orden estable", () => {
    const { estado, ctx } = partidaIniciada(4);
    jugarTodos(estado, ctx);
    const s1 = snapshotPara(estado, estado.juezUid);
    expect(s1.mesa).toHaveLength(3);
    for (const m of s1.mesa) {
      expect(m.carta).toBeTruthy();
      expect(m.jugadorUid).toBeNull();
      expect(m.nombre).toBeNull();
    }
    const s2 = snapshotPara(estado, noJueces(estado)[0].uid);
    expect(s2.mesa.map((m) => m.id)).toEqual(s1.mesa.map((m) => m.id));
  });

  it("en 'resultado': se revelan autores y la ganadora", () => {
    const { estado, ctx } = partidaIniciada(4);
    jugarTodos(estado, ctx);
    const ganadora = estado.mesa[0];
    elegirGanadora(estado, estado.juezUid, ganadora.id, ctx);

    const s = snapshotPara(estado, noJueces(estado)[0].uid);
    const vista = s.mesa.find((m) => m.id === ganadora.id);
    expect(vista.esGanadora).toBe(true);
    expect(vista.jugadorUid).toBe(ganadora.jugadorUid);
    expect(vista.nombre).toBe(jugador(estado, ganadora.jugadorUid).nombre);
    expect(s.sala.historial).toHaveLength(1);
  });

  it("expone la meta y los campos que el tablero necesita", () => {
    const { estado } = partidaIniciada(5);
    const s = snapshotPara(estado, "u1");
    expect(s.meta).toBe(7);
    expect(s.sala.fase).toBe("jugando");
    expect(s.sala.faseHasta).toBeGreaterThan(0);
    expect(s.jugadores).toHaveLength(5);
    for (const j of s.jugadores) {
      expect(j).toHaveProperty("conectado");
      expect(j).toHaveProperty("efectoRonda");
      expect(j).toHaveProperty("cartasAJugar");
      expect(j).not.toHaveProperty("efectoActivo"); // lo pendiente no se filtra
    }
  });

  it("jugada doble: 'jugaron' repite el uid", () => {
    const { estado, ctx } = partidaIniciada(4);
    const [a] = noJueces(estado);
    jugador(estado, a.uid).cartasAJugar = 2;
    jugarCarta(estado, a.uid, estado.manos[a.uid][0], ctx);
    jugarCarta(estado, a.uid, estado.manos[a.uid][0], ctx);
    const s = snapshotPara(estado, estado.juezUid);
    expect(s.jugaron).toEqual([a.uid, a.uid]);
  });
});
