// El ciclo de ronda: jugar cartas, cerrar la fase de envíos, avanzar de ronda
// y resolver timeouts. La complejidad del juego vive aquí.

import { exigir } from "./errores.js";
import {
  DURACIONES,
  debeCerrarJugadas,
  jugador,
  jugadasRonda,
  mano,
  transicionar,
} from "./estado.js";
import { premiarJugada } from "./juicio.js";
import { nuevaVerde, repartirMano } from "./mazos.js";
import { metaGanar } from "./partida.js";

// Ex jugar_carta: mueve una carta de la mano a la mesa y, si con eso jugaron
// todos los que tenían que jugar, cierra la fase de envíos.
export function jugarCarta(estado, uid, carta, ctx) {
  exigir(estado.fase === "jugando", "No es momento de jugar");
  exigir(estado.juezUid !== uid, "El Juez no juega carta");
  const j = jugador(estado, uid);
  exigir(j, "No estás en la sala");
  if (j.congeladoHasta !== null && j.congeladoHasta > ctx.now()) {
    exigir(false, "🥶 Tienes la mano congelada");
  }
  exigir(jugadasRonda(estado, uid).length < j.cartasAJugar, "Ya jugaste tus cartas");
  const cartas = mano(estado, uid);
  const idx = cartas.indexOf(carta);
  exigir(idx >= 0, "No tienes esa carta");

  cartas.splice(idx, 1);
  estado.mesa.push({
    id: `j${++estado.seq}`,
    ronda: estado.ronda,
    jugadorUid: uid,
    carta,
    esGanadora: false,
    jugadaEn: ctx.now(),
  });

  if (debeCerrarJugadas(estado)) cerrarJugadas(estado, ctx);
}

// Ex cerrar_jugadas. Piensa Rápido: si jugaron ≥2 y la ronda duró ≥5s, el
// último en enviar recupera sus cartas y no compite (si todos jugaron en <5s,
// nadie pierde). Solo aplica cuando la ronda cierra por completitud.
export function cerrarJugadas(estado, ctx) {
  if (estado.config.piensaRapido) {
    const jugadas = jugadasRonda(estado);
    const distintos = new Set(jugadas.map((m) => m.jugadorUid));
    const maxJugadaEn = Math.max(...jugadas.map((m) => m.jugadaEn));
    if (
      distintos.size >= 2 &&
      estado.rondaInicio !== null &&
      maxJugadaEn - estado.rondaInicio >= 5_000
    ) {
      const ultimo = jugadas.reduce((a, b) => (b.jugadaEn >= a.jugadaEn ? b : a))
        .jugadorUid;
      for (const m of jugadasRonda(estado, ultimo)) mano(estado, ultimo).push(m.carta);
      estado.mesa = estado.mesa.filter(
        (m) => !(m.ronda === estado.ronda && m.jugadorUid === ultimo)
      );
    }
  }

  transicionar(estado, "juzgando", ctx);
  estado.mejorMesaId = null;
}

// Siguiente Juez: el conectado con el menor `orden` mayor al del Juez actual,
// envolviendo al de menor `orden`; si no hay conectados, se queda el mismo.
function siguienteJuez(estado) {
  const conectados = estado.jugadores
    .filter((j) => j.conectado)
    .sort((a, b) => a.orden - b.orden);
  if (!conectados.length) return estado.juezUid;
  const ordenJuez = jugador(estado, estado.juezUid)?.orden;
  if (ordenJuez !== undefined) {
    const siguiente = conectados.find((j) => j.orden > ordenJuez);
    if (siguiente) return siguiente.uid;
  }
  return conectados[0].uid;
}

// Ex avanzar_ronda: descarta la mesa, rota el Juez, activa efectos pendientes,
// aplica la penalización del ex-Juez lento, repone manos y arranca la ronda.
export function avanzarRonda(estado, ctx) {
  const penalizado = estado.penalizadoUid;

  // Descartar las cartas jugadas: no vuelven a ninguna mano en esta partida.
  estado.descarteRojas.push(...estado.mesa.map((m) => m.carta));
  estado.mesa = [];

  for (const j of estado.jugadores) {
    j.efectoRonda = null;
    j.congeladoHasta = null;
    j.cartasAJugar = 1;
  }

  const juez = siguienteJuez(estado);

  // Activar los efectos pendientes. EXCEPCIÓN: el próximo Juez no juega, así
  // que conserva su efectoActivo pendiente para cuando vuelva a jugar.
  for (const j of estado.jugadores) {
    if (j.efectoActivo === null || j.uid === juez) continue;
    j.efectoRonda = j.efectoActivo;
    j.cartasAJugar = j.efectoActivo === "jugada_doble" ? 2 : 1;
    j.congeladoHasta =
      j.efectoActivo === "mano_congelada" ? ctx.now() + 10_000 : null;
    j.efectoActivo = null;
  }

  if (penalizado !== null && penalizado !== juez) {
    const j = jugador(estado, penalizado);
    if (j) {
      j.cartasAJugar = 0;
      j.efectoRonda = "sin_turno";
    }
  }

  for (const j of estado.jugadores) repartirMano(estado, j.uid, ctx);

  estado.cartaVerde = nuevaVerde(estado, ctx);
  estado.ronda += 1;
  estado.juezUid = juez;
  estado.mejorMesaId = null;
  estado.peorUid = null;
  estado.ruletaEfecto = null;
  estado.penalizadoUid = null;
  // Deadline y arranque explícitos: cubren también jugando→jugando (ronda saltada).
  estado.fase = "jugando";
  estado.faseHasta = ctx.now() + DURACIONES.jugando;
  estado.rondaInicio = ctx.now();
}

// Ex siguiente_ronda: el host o el Juez adelantan la pantalla de resultado.
export function siguienteRonda(estado, uid, ctx) {
  exigir(estado.fase === "resultado", "Aún no termina la ronda");
  exigir(
    uid === estado.hostUid || uid === estado.juezUid,
    "Solo el host o el Juez avanzan"
  );
  avanzarRonda(estado, ctx);
}

// Ex resolver_timeout. En el DO lo dispara la alarm (reloj del servidor), no el
// polling de los clientes. Devuelve true si venció y resolvió algo.
// - jugando: 0 jugadas → ronda saltada; 1 → gana sola (punto + historial, sin
//   juicio); ≥2 → a juzgar SIN pasar por cerrarJugadas (el timeout no aplica la
//   penalización de Piensa Rápido).
// - juzgando: el Juez lento queda penalizado (pierde su próximo envío) y la
//   ronda se salta.  - resultado: avanza.
export function resolverTimeout(estado, ctx) {
  if (estado.faseHasta === null || ctx.now() < estado.faseHasta) return false;

  if (estado.fase === "jugando") {
    const jugadas = jugadasRonda(estado);
    if (jugadas.length === 0) {
      avanzarRonda(estado, ctx);
    } else if (jugadas.length === 1) {
      const puntos = premiarJugada(estado, jugadas[0]);
      transicionar(estado, puntos >= metaGanar(estado) ? "terminado" : "resultado", ctx);
    } else {
      transicionar(estado, "juzgando", ctx);
      estado.mejorMesaId = null;
    }
  } else if (estado.fase === "juzgando") {
    estado.penalizadoUid = estado.juezUid;
    avanzarRonda(estado, ctx);
  } else if (estado.fase === "resultado") {
    avanzarRonda(estado, ctx);
  } else {
    return false;
  }
  return true;
}
