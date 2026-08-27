// Utilidades compartidas por los tests del motor: reloj falso, RNG sembrado,
// mazos sintéticos y armado de salas/partidas.

import { crearEstado, iniciarPartida, jugarCarta, makeRng, unirseSala } from "./index.js";

// ctx del motor con reloj controlable: ctx.avanzar(ms) mueve el tiempo.
export function ctxTest(seed = 42) {
  let t = 1_000_000_000;
  return {
    now: () => t,
    rng: makeRng(seed),
    avanzar(ms) {
      t += ms;
    },
  };
}

// rng que devuelve una secuencia fija (se repite el último valor): para forzar
// un resultado concreto de la ruleta.
export function rngSecuencia(valores) {
  let i = 0;
  return () => valores[Math.min(i++, valores.length - 1)];
}

export function mazoTest(nRojas = 80, nVerdes = 12) {
  return {
    rojas: Array.from({ length: nRojas }, (_, i) => `R${i + 1}`),
    verdes: Array.from({ length: nVerdes }, (_, i) => `V${i + 1}`),
  };
}

// Sala en lobby con n jugadores u1..uN (u1 es host).
export function salaConJugadores(n) {
  const estado = crearEstado("ABC234", "u1", "Jugador 1");
  for (let i = 2; i <= n; i++) unirseSala(estado, `u${i}`, `Jugador ${i}`);
  return estado;
}

// Partida ya iniciada. opts: { seed, config, mazo }.
export function partidaIniciada(n, opts = {}) {
  const ctx = ctxTest(opts.seed);
  const estado = salaConJugadores(n);
  if (opts.config) Object.assign(estado.config, opts.config);
  iniciarPartida(estado, "u1", opts.mazo ?? mazoTest(), ctx);
  return { estado, ctx };
}

export function noJueces(estado) {
  return estado.jugadores.filter((j) => j.uid !== estado.juezUid);
}

export function jugadasDe(estado, uid) {
  return estado.mesa.filter((m) => m.ronda === estado.ronda && m.jugadorUid === uid);
}

// Todos los no-Juez juegan sus cartas pendientes (la última jugada cierra la
// fase). msEntreJugadas controla el reparto temporal (Piensa Rápido).
export function jugarTodos(estado, ctx, msEntreJugadas = 0) {
  for (const j of noJueces(estado)) {
    while (estado.fase === "jugando" && jugadasDe(estado, j.uid).length < j.cartasAJugar) {
      if (msEntreJugadas) ctx.avanzar(msEntreJugadas);
      jugarCarta(estado, j.uid, estado.manos[j.uid][0], ctx);
    }
  }
}
