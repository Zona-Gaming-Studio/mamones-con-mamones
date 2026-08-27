import { describe, expect, it } from "vitest";
import {
  abandonarSala,
  jugador,
  jugarCarta,
  marcarConexion,
} from "./index.js";
import {
  ctxTest,
  jugadasDe,
  noJueces,
  partidaIniciada,
  salaConJugadores,
} from "./test-utils.js";

describe("repararSala", () => {
  it("migra el host al conectado de menor orden", () => {
    const { estado, ctx } = partidaIniciada(4);
    marcarConexion(estado, "u1", false, ctx);
    expect(estado.hostUid).toBe("u2");
    // Y vuelve a migrar si regresa otro con menor orden… no: el host no rebota.
    marcarConexion(estado, "u1", true, ctx);
    expect(estado.hostUid).toBe("u2");
  });

  it("con menos de 2 conectados en juego, pausa a lobby conservando puntos", () => {
    const { estado, ctx } = partidaIniciada(4);
    estado.jugadores[2].puntos = 3;
    marcarConexion(estado, "u1", false, ctx);
    marcarConexion(estado, "u2", false, ctx);
    marcarConexion(estado, "u3", false, ctx);
    expect(estado.fase).toBe("lobby");
    expect(estado.faseHasta).toBeNull();
    expect(estado.ronda).toBe(0);
    expect(estado.juezUid).toBeNull();
    expect(estado.cartaVerde).toBeNull();
    expect(jugador(estado, "u3").puntos).toBe(3);
  });

  it("reasigna el Juez caído y el nuevo Juez recupera sus cartas jugadas", () => {
    const { estado, ctx } = partidaIniciada(4);
    // El de menor orden conectado será el nuevo Juez: hacer que ya haya jugado.
    const porOrden = estado.jugadores.slice().sort((a, b) => a.orden - b.orden);
    const nuevoJuez = porOrden.find((j) => j.uid !== estado.juezUid);
    jugarCarta(estado, nuevoJuez.uid, estado.manos[nuevoJuez.uid][0], ctx);
    expect(estado.manos[nuevoJuez.uid]).toHaveLength(6);

    marcarConexion(estado, estado.juezUid, false, ctx);
    expect(estado.juezUid).toBe(nuevoJuez.uid);
    expect(estado.manos[nuevoJuez.uid]).toHaveLength(7); // recuperó su jugada
    expect(jugadasDe(estado, nuevoJuez.uid)).toHaveLength(0);
  });

  it("desbloquea el cierre cuando el que faltaba se desconecta", () => {
    const { estado, ctx } = partidaIniciada(4);
    const [a, b, c] = noJueces(estado);
    jugarCarta(estado, a.uid, estado.manos[a.uid][0], ctx);
    jugarCarta(estado, b.uid, estado.manos[b.uid][0], ctx);
    expect(estado.fase).toBe("jugando"); // falta c
    marcarConexion(estado, c.uid, false, ctx);
    expect(estado.fase).toBe("juzgando");
  });

  it("no cierra por desconexión si un conectado con jugada doble está a medias", () => {
    const { estado, ctx } = partidaIniciada(5);
    const [a, b, c, d] = noJueces(estado);
    jugador(estado, a.uid).cartasAJugar = 2; // 🃏 jugada doble activa
    jugarCarta(estado, a.uid, estado.manos[a.uid][0], ctx);
    jugarCarta(estado, b.uid, estado.manos[b.uid][0], ctx);
    jugarCarta(estado, c.uid, estado.manos[c.uid][0], ctx);
    marcarConexion(estado, d.uid, false, ctx);
    // Con el conteo viejo (3 jugadas >= 3 conectados no-Juez) esto cerraba
    // dejando a la jugada doble a medias.
    expect(estado.fase).toBe("jugando");
    jugarCarta(estado, a.uid, estado.manos[a.uid][0], ctx);
    expect(estado.fase).toBe("juzgando");
  });
});

describe("abandonarSala", () => {
  it("quema las cartas del que se va y repara la sala", () => {
    const { estado, ctx } = partidaIniciada(4);
    const [a] = noJueces(estado);
    jugarCarta(estado, a.uid, estado.manos[a.uid][0], ctx);
    const mano = [...estado.manos[a.uid]];
    const jugada = jugadasDe(estado, a.uid)[0].carta;

    const vacia = abandonarSala(estado, a.uid, ctx);
    expect(vacia).toBe(false);
    expect(estado.jugadores.map((j) => j.uid)).not.toContain(a.uid);
    expect(estado.manos[a.uid]).toBeUndefined();
    expect(estado.mesa.map((m) => m.carta)).not.toContain(jugada);
    // Fix del port: mano y jugada van al descarte, no de vuelta al pool.
    expect(estado.descarteRojas).toEqual(expect.arrayContaining([...mano, jugada]));
  });

  it("devuelve true cuando la sala queda vacía", () => {
    const estado = salaConJugadores(2);
    const ctx = ctxTest();
    expect(abandonarSala(estado, "u1", ctx)).toBe(false);
    expect(estado.hostUid).toBe("u2"); // host migrado
    expect(abandonarSala(estado, "u2", ctx)).toBe(true);
  });

  it("si se va el Juez, se reasigna y la partida sigue", () => {
    const { estado, ctx } = partidaIniciada(4);
    const juez = estado.juezUid;
    abandonarSala(estado, juez, ctx);
    expect(estado.jugadores).toHaveLength(3);
    expect(estado.juezUid).not.toBe(juez);
    expect(jugador(estado, estado.juezUid)).toBeTruthy();
  });
});
