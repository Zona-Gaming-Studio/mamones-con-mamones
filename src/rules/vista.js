// Snapshot por jugador: la vista censurada del estado que el servidor empuja a
// cada cliente. Reemplaza a mesa_actual + las políticas RLS: mano solo propia,
// mesa anónima hasta 'resultado', cartas ocultas durante 'jugando'. Su forma
// replica lo que hoy montan los seis fetches de OnlineGame.jsx.

import { jugadasRonda } from "./estado.js";
import { metaGanar } from "./partida.js";
import { hashStr } from "./rng.js";

export function snapshotPara(estado, uid) {
  const verCarta = ["juzgando", "resultado", "terminado"].includes(estado.fase);
  const verAutor = ["resultado", "terminado"].includes(estado.fase);
  const nombres = new Map(estado.jugadores.map((j) => [j.uid, j.nombre]));

  // Ex mesa_actual: orden anónimo pero estable entre snapshots (hash del id).
  const mesa = jugadasRonda(estado)
    .map((m) => ({
      id: m.id,
      carta: verCarta ? m.carta : null,
      esGanadora: m.esGanadora,
      jugadorUid: verAutor ? m.jugadorUid : null,
      nombre: verAutor ? nombres.get(m.jugadorUid) ?? null : null,
    }))
    .sort((a, b) => hashStr(a.id) - hashStr(b.id));

  return {
    sala: {
      codigo: estado.codigo,
      fase: estado.fase,
      ronda: estado.ronda,
      hostUid: estado.hostUid,
      juezUid: estado.juezUid,
      cartaVerde: estado.cartaVerde,
      config: estado.config,
      faseHasta: estado.faseHasta,
      rondaInicio: estado.rondaInicio,
      penalizadoUid: estado.penalizadoUid,
      mejorMesaId: estado.mejorMesaId,
      peorUid: estado.peorUid,
      ruletaEfecto: estado.ruletaEfecto,
      historial: estado.historial,
    },
    meta: metaGanar(estado),
    jugadores: estado.jugadores.map((j) => ({
      uid: j.uid,
      nombre: j.nombre,
      puntos: j.puntos,
      orden: j.orden,
      conectado: j.conectado,
      efectoRonda: j.efectoRonda,
      cartasAJugar: j.cartasAJugar,
      congeladoHasta: j.congeladoHasta,
    })),
    mesa,
    // Quiénes ya jugaron (con duplicados si hubo jugada doble): pinta el "✓
    // jugó" sin revelar cartas.
    jugaron: jugadasRonda(estado).map((m) => m.jugadorUid),
    // Las jugadas propias siempre se ven completas (tu carta boca arriba en el
    // montoncito).
    misJugadas: jugadasRonda(estado, uid).map((m) => ({
      id: m.id,
      carta: m.carta,
      esGanadora: m.esGanadora,
      jugadaEn: m.jugadaEn,
    })),
    mano: estado.manos[uid] ?? [],
  };
}
