import { describe, expect, it } from "vitest";
import {
  elegirGanadora,
  jugador,
  jugarCarta,
  resolverTimeout,
} from "./index.js";
import { jugarTodos, noJueces, partidaIniciada } from "./test-utils.js";

describe("resolverTimeout", () => {
  it("no hace nada antes del deadline", () => {
    const { estado, ctx } = partidaIniciada(4);
    ctx.avanzar(59_000);
    expect(resolverTimeout(estado, ctx)).toBe(false);
    expect(estado.fase).toBe("jugando");
    expect(estado.ronda).toBe(1);
  });

  it("jugando sin jugadas: la ronda se salta", () => {
    const { estado, ctx } = partidaIniciada(4);
    const verdeAnterior = estado.cartaVerde;
    ctx.avanzar(60_000);
    expect(resolverTimeout(estado, ctx)).toBe(true);
    expect(estado.fase).toBe("jugando");
    expect(estado.ronda).toBe(2);
    expect(estado.cartaVerde).not.toBe(verdeAnterior);
    expect(estado.faseHasta).toBe(ctx.now() + 60_000);
    expect(estado.historial).toHaveLength(0);
  });

  it("jugando con una sola jugada: gana sola, con punto e historial", () => {
    const { estado, ctx } = partidaIniciada(4);
    const [unico] = noJueces(estado);
    jugarCarta(estado, unico.uid, estado.manos[unico.uid][0], ctx);
    ctx.avanzar(60_000);
    resolverTimeout(estado, ctx);
    expect(estado.fase).toBe("resultado");
    expect(jugador(estado, unico.uid).puntos).toBe(1);
    expect(estado.historial).toHaveLength(1);
    expect(estado.historial[0].ganadorUid).toBe(unico.uid);
    expect(estado.mesa[0].esGanadora).toBe(true);
  });

  it("jugando con dos o más: pasa a juzgar sin penalización de Piensa Rápido", () => {
    const { estado, ctx } = partidaIniciada(6, { config: { piensaRapido: true } });
    const [a, b] = noJueces(estado);
    ctx.avanzar(10_000); // > 5s desde rondaInicio: la penalización aplicaría al cerrar
    jugarCarta(estado, a.uid, estado.manos[a.uid][0], ctx);
    ctx.avanzar(1_000);
    jugarCarta(estado, b.uid, estado.manos[b.uid][0], ctx);
    ctx.avanzar(60_000);
    resolverTimeout(estado, ctx);
    expect(estado.fase).toBe("juzgando");
    expect(estado.mesa).toHaveLength(2); // nadie recuperó cartas: timeout ≠ cierre por completitud
    expect(estado.faseHasta).toBe(ctx.now() + 45_000);
  });

  it("juzgando: el Juez lento queda penalizado y pierde su próximo envío", () => {
    const { estado, ctx } = partidaIniciada(4);
    const juezLento = estado.juezUid;
    jugarTodos(estado, ctx);
    ctx.avanzar(45_000);
    resolverTimeout(estado, ctx);
    expect(estado.fase).toBe("jugando");
    expect(estado.ronda).toBe(2);
    const castigado = jugador(estado, juezLento);
    expect(castigado.cartasAJugar).toBe(0);
    expect(castigado.efectoRonda).toBe("sin_turno");
    expect(estado.penalizadoUid).toBeNull(); // consumido al avanzar
    expect(() =>
      jugarCarta(estado, juezLento, estado.manos[juezLento][0], ctx)
    ).toThrow("Ya jugaste tus cartas");
  });

  it("la penalización se pierde si al castigado le toca ser Juez", () => {
    const { estado, ctx } = partidaIniciada(4);
    const juezLento = estado.juezUid;
    jugarTodos(estado, ctx); // → juzgando
    // Solo el Juez sigue conectado → la rotación lo deja como próximo Juez.
    for (const j of estado.jugadores) {
      if (j.uid !== juezLento) j.conectado = false;
    }
    ctx.avanzar(45_000);
    resolverTimeout(estado, ctx);
    expect(estado.juezUid).toBe(juezLento);
    const j = jugador(estado, juezLento);
    expect(j.efectoRonda).toBeNull();
    expect(j.cartasAJugar).toBe(1);
  });

  it("resultado: avanza la ronda al vencer", () => {
    const { estado, ctx } = partidaIniciada(4);
    jugarTodos(estado, ctx);
    elegirGanadora(estado, estado.juezUid, estado.mesa[0].id, ctx);
    expect(estado.fase).toBe("resultado");
    ctx.avanzar(25_000);
    resolverTimeout(estado, ctx);
    expect(estado.fase).toBe("jugando");
    expect(estado.ronda).toBe(2);
  });

  it("en terminado y lobby no hay reloj", () => {
    const { estado, ctx } = partidaIniciada(4, { config: { meta: 1 } });
    jugarTodos(estado, ctx);
    elegirGanadora(estado, estado.juezUid, estado.mesa[0].id, ctx);
    expect(estado.fase).toBe("terminado");
    expect(estado.faseHasta).toBeNull();
    ctx.avanzar(999_000);
    expect(resolverTimeout(estado, ctx)).toBe(false);
  });
});
