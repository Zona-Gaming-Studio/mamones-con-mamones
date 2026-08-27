import { describe, expect, it } from "vitest";
import {
  avanzarRonda,
  girarRuletaPara,
  jugador,
  jugarCarta,
  pasarMamon,
} from "./index.js";
import { jugarTodos, noJueces, partidaIniciada, rngSecuencia } from "./test-utils.js";

// rng() en [k/6, (k+1)/6) → la ruleta cae en el efecto k+1.
const cae = (efecto) => (efecto - 1) / 6 + 0.001;

describe("sorteo de la ruleta", () => {
  it("🥶 (2) solo entra al sorteo con Piensa Rápido", () => {
    const { estado, ctx } = partidaIniciada(4);
    for (let i = 0; i < 200; i++) {
      girarRuletaPara(estado, "u2", 0, ctx);
      expect(estado.ruletaEfecto).not.toBe(2);
    }
  });

  it("con Piensa Rápido pueden salir los 6 efectos", () => {
    const { estado, ctx } = partidaIniciada(6, { config: { piensaRapido: true } });
    const vistos = new Set();
    for (let i = 0; i < 300; i++) {
      girarRuletaPara(estado, "u2", 0, ctx);
      vistos.add(estado.ruletaEfecto);
      // Limpiar el efecto diferido para no acumular estado entre giros.
      jugador(estado, "u2").efectoActivo = null;
    }
    expect([...vistos].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("el re-giro de 'pasa el mamón' nunca vuelve a caer en 5", () => {
    const { estado, ctx } = partidaIniciada(4);
    for (let i = 0; i < 200; i++) {
      girarRuletaPara(estado, "u2", 3, ctx);
      expect(estado.ruletaEfecto).not.toBe(5);
      jugador(estado, "u2").efectoActivo = null;
    }
  });

  it("con rechazo, re-sortea hasta un efecto válido", () => {
    const { estado } = partidaIniciada(4);
    const ctx = { now: () => 0, rng: rngSecuencia([cae(2), cae(5), cae(6)]) };
    girarRuletaPara(estado, "u2", 3, { ...ctx }); // 2 (sin PR) y 5 (depth 3) rechazados
    expect(estado.ruletaEfecto).toBe(6);
  });
});

describe("efectos", () => {
  // Deja al objetivo como el Juez saliente + 2 en la rueda de órdenes: el
  // próximo Juez cae en otro jugador y el efecto pendiente sí se activa.
  function evitarQueSeaJuez(estado, objetivo) {
    const porOrden = estado.jugadores.slice().sort((a, b) => a.orden - b.orden);
    const idx = porOrden.findIndex((j) => j.uid === objetivo);
    estado.juezUid = porOrden[(idx + 1) % porOrden.length].uid;
  }

  function conEfecto(efecto, opts = {}) {
    const r = partidaIniciada(6, {
      config: { piensaRapido: Boolean(opts.piensaRapido) },
    });
    const objetivo = noJueces(r.estado)[0].uid;
    girarRuletaPara(r.estado, objetivo, 0, {
      ...r.ctx,
      rng: rngSecuencia([cae(efecto)]),
    });
    return { ...r, objetivo };
  }

  it("los diferidos (1, 4, 6) quedan pendientes y se activan al avanzar", () => {
    for (const efecto of [1, 4, 6]) {
      const { estado, ctx, objetivo } = conEfecto(efecto);
      const clave = { 1: "pela_el_ojo", 4: "jugar_a_ciegas", 6: "jugada_doble" }[efecto];
      expect(jugador(estado, objetivo).efectoActivo).toBe(clave);
      expect(jugador(estado, objetivo).efectoRonda).toBeNull();
      evitarQueSeaJuez(estado, objetivo);
      avanzarRonda(estado, ctx);
      const j = jugador(estado, objetivo);
      expect(j.efectoRonda).toBe(clave);
      expect(j.efectoActivo).toBeNull();
      expect(j.cartasAJugar).toBe(efecto === 6 ? 2 : 1);
    }
  });

  it("🥶 congela la mano 10s y jugarCarta lo respeta", () => {
    const { estado, ctx, objetivo } = conEfecto(2, { piensaRapido: true });
    evitarQueSeaJuez(estado, objetivo);
    avanzarRonda(estado, ctx);
    const j = jugador(estado, objetivo);
    expect(j.efectoRonda).toBe("mano_congelada");
    expect(j.congeladoHasta).toBe(ctx.now() + 10_000);
    expect(() =>
      jugarCarta(estado, objetivo, estado.manos[objetivo][0], ctx)
    ).toThrow("🥶 Tienes la mano congelada");
    ctx.avanzar(10_001);
    jugarCarta(estado, objetivo, estado.manos[objetivo][0], ctx);
  });

  it("🌪️ baraja la mano de inmediato y quema la vieja", () => {
    const { estado, ctx } = partidaIniciada(6);
    const objetivo = noJueces(estado)[0].uid;
    const manoVieja = [...estado.manos[objetivo]];
    girarRuletaPara(estado, objetivo, 0, { ...ctx, rng: rngSecuencia([cae(3)]) });
    expect(estado.manos[objetivo]).toHaveLength(7);
    expect(estado.descarteRojas).toEqual(manoVieja); // la vieja, quemada entera
    for (const c of estado.manos[objetivo]) expect(manoVieja).not.toContain(c);
    expect(jugador(estado, objetivo).efectoActivo).toBeNull();
  });

  it("el próximo Juez conserva su efecto pendiente hasta volver a jugar", () => {
    const { estado, ctx, objetivo } = conEfecto(6);
    // Forzar que el objetivo SEA el próximo Juez: el Juez actual pasa a ser el
    // de mayor orden por debajo del objetivo, o el de mayor orden absoluto si
    // el objetivo es el de menor orden (la rotación envuelve hacia él).
    const orden = jugador(estado, objetivo).orden;
    const porOrden = estado.jugadores.slice().sort((a, b) => a.orden - b.orden);
    const previo = porOrden.filter((j) => j.orden < orden).at(-1) ?? porOrden.at(-1);
    estado.juezUid = previo.uid;
    avanzarRonda(estado, ctx);
    expect(estado.juezUid).toBe(objetivo);
    let j = jugador(estado, objetivo);
    expect(j.efectoActivo).toBe("jugada_doble"); // conservado (fix 0020)
    expect(j.efectoRonda).toBeNull();
    expect(j.cartasAJugar).toBe(1);

    avanzarRonda(estado, ctx); // deja de ser Juez → ahora sí se activa
    j = jugador(estado, objetivo);
    expect(j.efectoActivo).toBeNull();
    expect(j.efectoRonda).toBe("jugada_doble");
    expect(j.cartasAJugar).toBe(2);
  });
});

describe("pasar el mamón", () => {
  function conMamon() {
    const r = partidaIniciada(4);
    jugarTodos(r.estado, r.ctx);
    r.estado.fase = "resultado";
    girarRuletaPara(r.estado, "u2", 0, { ...r.ctx, rng: rngSecuencia([cae(5)]) });
    return r;
  }

  it("valida fase, efecto, dueño y objetivo", () => {
    const { estado, ctx } = conMamon();
    expect(estado.ruletaEfecto).toBe(5);
    expect(() => pasarMamon(estado, "u3", "u4", ctx)).toThrow("No te toca pasarlo");
    expect(() => pasarMamon(estado, "u2", "u2", ctx)).toThrow("No puedes pasártelo a ti");
    expect(() => pasarMamon(estado, "u2", "fantasma", ctx)).toThrow("Jugador inválido");
    estado.fase = "juzgando";
    expect(() => pasarMamon(estado, "u2", "u3", ctx)).toThrow("Fuera de tiempo");
  });

  it("re-gira sobre el objetivo (sin 5) y refresca el deadline", () => {
    const { estado, ctx } = conMamon();
    pasarMamon(estado, "u2", "u3", ctx);
    expect(estado.peorUid).toBe("u3");
    expect(estado.ruletaEfecto).not.toBe(5);
    expect(estado.faseHasta).toBe(ctx.now() + 25_000);
  });
});
