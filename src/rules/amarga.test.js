import { describe, expect, it } from "vitest";
import { elegirGanadora, elegirPeor, jugador } from "./index.js";
import { jugadasDe, jugarTodos, noJueces, partidaIniciada } from "./test-utils.js";

function partidaAmarga(n = 4, extra = {}) {
  const r = partidaIniciada(n, { config: { modo: "amarga", ...extra } });
  jugarTodos(r.estado, r.ctx);
  return r;
}

describe("modo Amargo", () => {
  it("elegir la mejor no cambia de fase: falta la peor", () => {
    const { estado, ctx } = partidaAmarga();
    const faseHastaAntes = estado.faseHasta;
    const mejor = estado.mesa[0];
    elegirGanadora(estado, estado.juezUid, mejor.id, ctx);
    expect(estado.fase).toBe("juzgando");
    expect(estado.mejorMesaId).toBe(mejor.id);
    expect(estado.faseHasta).toBe(faseHastaAntes); // el deadline NO se refresca
    expect(jugador(estado, mejor.jugadorUid).puntos).toBe(1);
    expect(estado.historial).toHaveLength(1);
    // Repetir "mejor" está prohibido: toca la peor.
    expect(() => elegirGanadora(estado, estado.juezUid, estado.mesa[1].id, ctx)).toThrow(
      "Ahora elige la PEOR carta"
    );
  });

  it("elegir la peor gira la ruleta sobre su autor y pasa a resultado", () => {
    const { estado, ctx } = partidaAmarga();
    elegirGanadora(estado, estado.juezUid, estado.mesa[0].id, ctx);
    const peor = estado.mesa[1];
    elegirPeor(estado, estado.juezUid, peor.id, ctx);
    expect(estado.fase).toBe("resultado");
    expect(estado.peorUid).toBe(peor.jugadorUid);
    expect(estado.ruletaEfecto).toBeGreaterThanOrEqual(1);
    expect(estado.ruletaEfecto).toBeLessThanOrEqual(6);
    expect(estado.ruletaEfecto).not.toBe(2); // 🥶 excluida sin Piensa Rápido
  });

  it("valida orden, rol y jugadas del doble juicio", () => {
    const { estado, ctx } = partidaAmarga();
    const [mejor, otra] = estado.mesa;
    expect(() => elegirPeor(estado, estado.juezUid, otra.id, ctx)).toThrow(
      "Primero elige la mejor"
    );
    elegirGanadora(estado, estado.juezUid, mejor.id, ctx);
    expect(() => elegirPeor(estado, estado.juezUid, mejor.id, ctx)).toThrow(
      "Esa es la mejor, no la peor"
    );
    expect(() => elegirPeor(estado, "u9", otra.id, ctx)).toThrow("Solo el Juez elige");
    expect(() => elegirPeor(estado, estado.juezUid, "no-existe", ctx)).toThrow(
      "Jugada inválida"
    );
  });

  it("si la mejor alcanza la meta, termina sin girar la ruleta", () => {
    const { estado, ctx } = partidaAmarga(4, { meta: 1 });
    elegirGanadora(estado, estado.juezUid, estado.mesa[0].id, ctx);
    expect(estado.fase).toBe("terminado");
    expect(estado.ruletaEfecto).toBeNull();
    expect(estado.peorUid).toBeNull();
  });

  it("en modo clásico no hay 'peor'", () => {
    const { estado, ctx } = partidaIniciada(4);
    jugarTodos(estado, ctx);
    elegirGanadora(estado, estado.juezUid, estado.mesa[0].id, ctx);
    expect(estado.fase).toBe("resultado"); // clásica cierra de una
    expect(() => elegirPeor(estado, estado.juezUid, estado.mesa[1].id, ctx)).toThrow(
      "Solo en modo Amargo"
    );
  });

  it("el autor de la peor conserva la posibilidad de jugar la ronda siguiente", () => {
    // La ruleta castiga, pero no es la penalización sin_turno del Juez lento.
    const { estado, ctx } = partidaAmarga();
    elegirGanadora(estado, estado.juezUid, estado.mesa[0].id, ctx);
    const peor = estado.mesa[1];
    elegirPeor(estado, estado.juezUid, peor.id, ctx);
    expect(jugadasDe(estado, peor.jugadorUid).length).toBeGreaterThan(0);
    expect(jugador(estado, peor.jugadorUid).efectoRonda).not.toBe("sin_turno");
  });
});
