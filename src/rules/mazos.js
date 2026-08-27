// Reparto de rojas y verdes. Regla: en una partida no se repiten cartas.
// Una roja está en juego (mano o mesa) como mucho una vez y al jugarse va al
// descarte hasta que el mazo activo se agota (entonces el descarte se recicla).

import { MANO_SIZE, mano } from "./estado.js";
import { elegirAzar, tomarAzar } from "./rng.js";

function rojasEnJuego(estado) {
  const usadas = new Set();
  for (const cartas of Object.values(estado.manos)) {
    for (const c of cartas) usadas.add(c);
  }
  for (const m of estado.mesa) usadas.add(m.carta);
  return usadas;
}

// Ex repartir_mano: repone hasta 7 rojas que no estén en juego ni descartadas.
// Si el mazo se agota, recicla el descarte y rellena lo que falte.
export function repartirMano(estado, uid, ctx) {
  const cartas = mano(estado, uid);
  let faltan = MANO_SIZE - cartas.length;
  if (faltan <= 0) return;

  const enJuego = rojasEnJuego(estado);
  const descartadas = new Set(estado.descarteRojas);
  const disponibles = estado.mazo.rojas.filter(
    (c) => !enJuego.has(c) && !descartadas.has(c)
  );
  const primeras = tomarAzar(disponibles, faltan, ctx.rng);
  cartas.push(...primeras);
  faltan -= primeras.length;

  if (faltan > 0) {
    estado.descarteRojas = [];
    const enJuego2 = rojasEnJuego(estado);
    const resto = estado.mazo.rojas.filter((c) => !enJuego2.has(c));
    cartas.push(...tomarAzar(resto, faltan, ctx.rng));
  }
}

// Ex nueva_verde: verde al azar que no haya salido; si se agotaron, se
// reinicia el mazo verde. Registra la elegida y la devuelve.
export function nuevaVerde(estado, ctx) {
  const usadas = new Set(estado.verdesUsadas);
  let disponibles = estado.mazo.verdes.filter((v) => !usadas.has(v));
  if (!disponibles.length) {
    estado.verdesUsadas = [];
    disponibles = estado.mazo.verdes;
  }
  const v = elegirAzar(disponibles, ctx.rng);
  if (v !== null) estado.verdesUsadas.push(v);
  return v;
}
