// Motor de reglas de Mamones con Mamones — compartido por el multijugador
// (Durable Object) y, a futuro, el single-player Phaser.
//
// Uso: `aplicar(estado, accion, ctx)` muta el estado y lanza ReglaError si la
// acción no es válida (mensaje para el jugador).
// ctx = { now: () => msEpoch, rng: () => [0,1) } — ver rng.js.
//
// Fuera del despachador quedan las operaciones con ciclo de vida propio:
// `unirseSala` (RPC HTTP antes de abrir el WebSocket), `abandonarSala`
// (devuelve true si la sala quedó vacía y hay que destruirla), `marcarConexion`
// (ciclo de vida del WebSocket) y `resolverTimeout` (la alarm del DO, no un
// jugador).

import { exigir } from "./errores.js";
import { elegirGanadora, elegirPeor } from "./juicio.js";
import { iniciarPartida, reiniciarPartida } from "./partida.js";
import { jugarCarta, siguienteRonda } from "./ronda.js";
import { pasarMamon } from "./ruleta.js";
import { setConfigSala } from "./sala.js";

const ACCIONES = {
  set_config: (e, a) => setConfigSala(e, a.uid, a),
  iniciar: (e, a, ctx) => iniciarPartida(e, a.uid, a.mazo, ctx),
  jugar_carta: (e, a, ctx) => jugarCarta(e, a.uid, a.carta, ctx),
  elegir_ganadora: (e, a, ctx) => elegirGanadora(e, a.uid, a.mesaId, ctx),
  elegir_peor: (e, a, ctx) => elegirPeor(e, a.uid, a.mesaId, ctx),
  pasar_mamon: (e, a, ctx) => pasarMamon(e, a.uid, a.targetUid, ctx),
  siguiente_ronda: (e, a, ctx) => siguienteRonda(e, a.uid, ctx),
  reiniciar: (e, a, ctx) => reiniciarPartida(e, a.uid, ctx),
};

// Despacha una acción de jugador. Devuelve el estado (mutado).
export function aplicar(estado, accion, ctx) {
  const fn = ACCIONES[accion.tipo];
  exigir(fn, `Acción desconocida: ${accion.tipo}`);
  fn(estado, accion, ctx);
  return estado;
}

export { ReglaError } from "./errores.js";
export {
  DURACIONES,
  MANO_SIZE,
  MAX_JUGADORES,
  MIN_JUGADORES,
  crearEstado,
  jugador,
  transicionar,
} from "./estado.js";
export { cartasParaGanar, iniciarPartida, metaGanar, reiniciarPartida } from "./partida.js";
export { avanzarRonda, jugarCarta, resolverTimeout, siguienteRonda } from "./ronda.js";
export { elegirGanadora, elegirPeor } from "./juicio.js";
export { EFECTOS, girarRuletaPara, pasarMamon } from "./ruleta.js";
export { abandonarSala, marcarConexion, repararSala, setConfigSala, unirseSala } from "./sala.js";
export { snapshotPara } from "./vista.js";
export { hashStr, makeRng, mixSeed } from "./rng.js";
