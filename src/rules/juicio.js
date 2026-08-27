// El juicio del Juez: elegir la mejor (y en modo Amargo también la peor).

import { ReglaError, exigir } from "./errores.js";
import { jugador, jugadasRonda, transicionar } from "./estado.js";
import { metaGanar } from "./partida.js";
import { girarRuletaPara } from "./ruleta.js";

// Premia una jugada: marca ganadora, suma el punto y anexa la ronda al
// historial del recap. Devuelve los puntos del ganador (para el chequeo de
// meta). Compartida por elegirGanadora y el timeout "gana sola".
export function premiarJugada(estado, jugada) {
  jugada.esGanadora = true;
  const ganador = jugador(estado, jugada.jugadorUid);
  const puntos = ganador ? ++ganador.puntos : 0;
  estado.historial.push({
    ronda: estado.ronda,
    verde: estado.cartaVerde,
    roja: jugada.carta,
    ganadorUid: jugada.jugadorUid,
    ganador: ganador?.nombre ?? null,
  });
  return puntos;
}

// Ex elegir_ganadora. En modo Amargo NO cambia de fase: deja mejorMesaId y el
// Juez sigue en 'juzgando' para elegir la peor (mismo deadline de 45s).
export function elegirGanadora(estado, uid, mesaId, ctx) {
  exigir(estado.fase === "juzgando", "No es momento de juzgar");
  exigir(estado.juezUid === uid, "Solo el Juez elige");
  const amarga = estado.config.modo === "amarga";
  if (amarga && estado.mejorMesaId !== null) {
    throw new ReglaError("Ahora elige la PEOR carta");
  }

  const jugada = jugadasRonda(estado).find((m) => m.id === mesaId);
  exigir(jugada, "Jugada inválida");

  const puntos = premiarJugada(estado, jugada);

  if (puntos >= metaGanar(estado)) {
    transicionar(estado, "terminado", ctx);
  } else if (amarga) {
    estado.mejorMesaId = mesaId;
  } else {
    transicionar(estado, "resultado", ctx);
  }
}

// Ex elegir_peor: el autor de la peor gira la Ruleta del Mamón Amargo.
export function elegirPeor(estado, uid, mesaId, ctx) {
  exigir(estado.config.modo === "amarga", "Solo en modo Amargo");
  exigir(estado.fase === "juzgando", "No es momento de juzgar");
  exigir(estado.juezUid === uid, "Solo el Juez elige");
  exigir(estado.mejorMesaId !== null, "Primero elige la mejor");
  if (mesaId === estado.mejorMesaId) {
    throw new ReglaError("Esa es la mejor, no la peor");
  }

  const jugada = jugadasRonda(estado).find((m) => m.id === mesaId);
  exigir(jugada, "Jugada inválida");

  girarRuletaPara(estado, jugada.jugadorUid, 0, ctx);
  transicionar(estado, "resultado", ctx);
}
