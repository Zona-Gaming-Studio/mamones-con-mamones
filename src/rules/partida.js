// Inicio, reinicio y meta de la partida.

import { exigir } from "./errores.js";
import { MIN_JUGADORES, transicionar } from "./estado.js";
import { nuevaVerde, repartirMano } from "./mazos.js";
import { elegirAzar } from "./rng.js";

// Ex cartas_para_ganar: meta automática por número de jugadores.
export function cartasParaGanar(n) {
  if (n >= 8) return 4;
  if (n === 7) return 5;
  if (n === 6) return 6;
  if (n === 5) return 7;
  return 8; // 4 jugadores (mínimo)
}

// Ex meta_ganar. Durante la partida manda la meta congelada en iniciarPartida
// (corrige el port: antes se re-evaluaba en vivo y entradas/salidas de gente
// podían regalar victorias retroactivas); en lobby se calcula para mostrarla.
export function metaGanar(estado) {
  if (estado.metaCongelada !== null) return estado.metaCongelada;
  return estado.config.meta ?? cartasParaGanar(estado.jugadores.length);
}

// Ex iniciar_partida. `mazo` = { rojas: [textos], verdes: [textos] } — el
// catálogo activo (D1 en el server, cartas.json en el single-player), que queda
// congelado en el estado por el resto de la partida.
export function iniciarPartida(estado, uid, mazo, ctx) {
  exigir(estado.hostUid === uid, "Solo el host puede iniciar");
  exigir(estado.fase === "lobby", "La partida ya empezó");
  const n = estado.jugadores.length;
  exigir(n >= MIN_JUGADORES, `Se necesitan al menos ${MIN_JUGADORES} jugadores (hay ${n})`);

  if (n <= 5) estado.config.piensaRapido = false;
  if (mazo) estado.mazo = { rojas: mazo.rojas.slice(), verdes: mazo.verdes.slice() };

  estado.manos = {};
  estado.mesa = [];
  estado.verdesUsadas = [];
  estado.descarteRojas = [];
  estado.historial = [];
  estado.ronda = 0;
  estado.penalizadoUid = null;
  estado.metaCongelada = estado.config.meta ?? cartasParaGanar(n);
  for (const j of estado.jugadores) {
    j.efectoActivo = null;
    j.efectoRonda = null;
    j.congeladoHasta = null;
    j.cartasAJugar = 1;
  }

  for (const j of estado.jugadores) repartirMano(estado, j.uid, ctx);

  estado.juezUid = elegirAzar(estado.jugadores, ctx.rng).uid;
  estado.cartaVerde = nuevaVerde(estado, ctx);
  estado.mejorMesaId = null;
  estado.peorUid = null;
  estado.ruletaEfecto = null;
  estado.ronda = 1;
  transicionar(estado, "jugando", ctx);
}

// Ex reiniciar_partida (revancha): vuelve al lobby conservando jugadores.
export function reiniciarPartida(estado, uid, ctx) {
  exigir(estado.hostUid === uid, "Solo el host reinicia");

  estado.manos = {};
  estado.mesa = [];
  for (const j of estado.jugadores) j.puntos = 0;
  estado.ronda = 0;
  estado.juezUid = null;
  estado.cartaVerde = null;
  estado.verdesUsadas = [];
  estado.descarteRojas = [];
  estado.historial = [];
  estado.metaCongelada = null;
  transicionar(estado, "lobby", ctx);
}
