import { describe, expect, it } from "vitest";
import {
  MANO_SIZE,
  ReglaError,
  abandonarSala,
  cartasParaGanar,
  iniciarPartida,
  metaGanar,
  reiniciarPartida,
  setConfigSala,
  unirseSala,
} from "./index.js";
import { ctxTest, mazoTest, partidaIniciada, salaConJugadores } from "./test-utils.js";

describe("unirseSala", () => {
  it("reconecta a un jugador existente y actualiza su nombre", () => {
    const estado = salaConJugadores(4);
    estado.jugadores[1].conectado = false;
    unirseSala(estado, "u2", "Nuevo Nombre");
    expect(estado.jugadores).toHaveLength(4);
    expect(estado.jugadores[1].conectado).toBe(true);
    expect(estado.jugadores[1].nombre).toBe("Nuevo Nombre");
  });

  it("rechaza unirse fuera del lobby", () => {
    const { estado } = partidaIniciada(4);
    expect(() => unirseSala(estado, "u9", "Tarde")).toThrow("La partida ya empezó");
  });

  it("el aforo cuenta jugadores presentes, no órdenes históricos", () => {
    const estado = salaConJugadores(10);
    const ctx = ctxTest();
    // Rotación de gente: se van dos, entran dos. Con el esquema viejo
    // (max(orden)+1 >= 10) esto daba "Sala llena" con 10 presentes.
    abandonarSala(estado, "u5", ctx);
    abandonarSala(estado, "u6", ctx);
    unirseSala(estado, "u11", "Once");
    unirseSala(estado, "u12", "Doce");
    expect(estado.jugadores).toHaveLength(10);
    expect(() => unirseSala(estado, "u13", "Trece")).toThrow("Sala llena (máximo 10)");
  });

  it("los órdenes nuevos no chocan con los existentes", () => {
    const estado = salaConJugadores(5);
    const ctx = ctxTest();
    abandonarSala(estado, "u2", ctx); // deja hueco en orden=1
    unirseSala(estado, "u6", "Seis");
    const ordenes = estado.jugadores.map((j) => j.orden);
    expect(new Set(ordenes).size).toBe(ordenes.length);
  });
});

describe("setConfigSala", () => {
  it("solo el host, solo en lobby, con validaciones", () => {
    const estado = salaConJugadores(4);
    expect(() =>
      setConfigSala(estado, "u2", { modo: "amarga", piensaRapido: false, meta: null })
    ).toThrow("Solo el host configura la sala");
    expect(() =>
      setConfigSala(estado, "u1", { modo: "extremo", piensaRapido: false, meta: null })
    ).toThrow("Modo inválido");
    expect(() =>
      setConfigSala(estado, "u1", { modo: "clasica", piensaRapido: false, meta: 21 })
    ).toThrow("Meta fuera de rango");
    setConfigSala(estado, "u1", { modo: "amarga", piensaRapido: false, meta: 5 });
    expect(estado.config).toEqual({ modo: "amarga", piensaRapido: false, meta: 5 });
  });

  it("Piensa Rápido exige más de 5 jugadores", () => {
    const chica = salaConJugadores(5);
    setConfigSala(chica, "u1", { modo: "clasica", piensaRapido: true, meta: null });
    expect(chica.config.piensaRapido).toBe(false);

    const grande = salaConJugadores(6);
    setConfigSala(grande, "u1", { modo: "clasica", piensaRapido: true, meta: null });
    expect(grande.config.piensaRapido).toBe(true);
  });
});

describe("iniciarPartida", () => {
  it("exige host, lobby y al menos 4 jugadores", () => {
    const estado = salaConJugadores(3);
    const ctx = ctxTest();
    expect(() => iniciarPartida(estado, "u2", mazoTest(), ctx)).toThrow(
      "Solo el host puede iniciar"
    );
    expect(() => iniciarPartida(estado, "u1", mazoTest(), ctx)).toThrow(
      "Se necesitan al menos 4 jugadores (hay 3)"
    );
  });

  it("arranca la ronda 1 con manos de 7, juez, verde y deadline de 45s", () => {
    const { estado, ctx } = partidaIniciada(4);
    expect(estado.fase).toBe("jugando");
    expect(estado.ronda).toBe(1);
    expect(estado.juezUid).toBeTruthy();
    expect(estado.cartaVerde).toMatch(/^V/);
    expect(estado.faseHasta).toBe(ctx.now() + 45_000);
    expect(estado.rondaInicio).toBe(ctx.now());
    for (const j of estado.jugadores) {
      expect(estado.manos[j.uid]).toHaveLength(MANO_SIZE);
    }
    // Ninguna carta repetida entre manos.
    const todas = Object.values(estado.manos).flat();
    expect(new Set(todas).size).toBe(todas.length);
  });

  it("apaga Piensa Rápido con 5 o menos jugadores", () => {
    const estado = salaConJugadores(5);
    estado.config.piensaRapido = true; // forzado a mano: simula config heredada
    iniciarPartida(estado, "u1", mazoTest(), ctxTest());
    expect(estado.config.piensaRapido).toBe(false);
  });

  it("congela la meta: no cambia aunque se vaya gente", () => {
    const { estado } = partidaIniciada(5);
    expect(metaGanar(estado)).toBe(7); // automática para 5
    estado.fase = "terminado"; // abandonar en partida sin disparar reparaciones de juego
    abandonarSala(estado, "u5", ctxTest());
    expect(estado.jugadores).toHaveLength(4);
    expect(metaGanar(estado)).toBe(7); // la viva daría 8
  });

  it("respeta la meta configurada", () => {
    const { estado } = partidaIniciada(4, { config: { meta: 3 } });
    expect(metaGanar(estado)).toBe(3);
  });
});

describe("cartasParaGanar", () => {
  it("aplica la tabla 4→8, 5→7, 6→6, 7→5, 8+→4", () => {
    expect(cartasParaGanar(4)).toBe(8);
    expect(cartasParaGanar(5)).toBe(7);
    expect(cartasParaGanar(6)).toBe(6);
    expect(cartasParaGanar(7)).toBe(5);
    expect(cartasParaGanar(8)).toBe(4);
    expect(cartasParaGanar(10)).toBe(4);
  });
});

describe("reiniciarPartida", () => {
  it("vuelve al lobby limpio conservando jugadores", () => {
    const { estado, ctx } = partidaIniciada(4);
    estado.jugadores[0].puntos = 3;
    estado.historial.push({ ronda: 1 });
    expect(() => reiniciarPartida(estado, "u2", ctx)).toThrow("Solo el host reinicia");
    reiniciarPartida(estado, "u1", ctx);
    expect(estado.fase).toBe("lobby");
    expect(estado.faseHasta).toBeNull();
    expect(estado.ronda).toBe(0);
    expect(estado.juezUid).toBeNull();
    expect(estado.historial).toEqual([]);
    expect(estado.metaCongelada).toBeNull();
    expect(estado.jugadores.map((j) => j.puntos)).toEqual([0, 0, 0, 0]);
    expect(Object.keys(estado.manos)).toHaveLength(0);
  });
});

describe("errores del motor", () => {
  it("las validaciones lanzan ReglaError (no Error genérico)", () => {
    const estado = salaConJugadores(3);
    try {
      iniciarPartida(estado, "u1", mazoTest(), ctxTest());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ReglaError);
    }
  });
});
