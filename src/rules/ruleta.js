// La Ruleta del Mamón Amargo: sorteo y aplicación de los 6 efectos.

import { ReglaError, exigir } from "./errores.js";
import { jugador, mano } from "./estado.js";
import { repartirMano } from "./mazos.js";

export const EFECTOS = {
  1: "pela_el_ojo", // 👀 mano boca abajo la próxima ronda (visual, client-side)
  2: "mano_congelada", // 🥶 10s sin jugar (solo entra al sorteo con Piensa Rápido)
  3: "mazo_barajado", // 🌪️ inmediato: mano al descarte y se reparte una nueva
  4: "jugar_a_ciegas", // ⏳ juega sin ver la verde (visual, client-side)
  5: "pasa_mamon", // 🤢 puede transferirlo durante 'resultado' (no re-encadenable)
  6: "jugada_doble", // 🃏 juega DOS cartas la próxima ronda
};

// Ex girar_ruleta_para. depth >= 3 = re-giro de "pasa el mamón": el receptor no
// puede volver a pasarlo (se excluye el 5 del sorteo).
export function girarRuletaPara(estado, uid, depth, ctx) {
  const piensa = Boolean(estado.config.piensaRapido);

  let pick;
  do {
    pick = Math.floor(ctx.rng() * 6) + 1;
  } while ((pick === 5 && depth >= 3) || (pick === 2 && !piensa));

  const clave = EFECTOS[pick];
  estado.ruletaEfecto = pick;
  estado.peorUid = uid;

  const j = jugador(estado, uid);
  if (!j) return;

  if (clave === "mazo_barajado") {
    // Inmediato: la mano vieja se quema y se reparte una nueva.
    estado.descarteRojas.push(...mano(estado, uid));
    estado.manos[uid] = [];
    repartirMano(estado, uid, ctx);
    j.efectoActivo = null;
  } else if (clave === "pasa_mamon") {
    j.efectoActivo = null; // pendiente de acción del jugador, no de la ronda
  } else {
    j.efectoActivo = clave; // diferido: se activa en la próxima avanzarRonda
  }
}

// Ex pasar_mamon: el castigado transfiere la ruleta a otro durante 'resultado'.
export function pasarMamon(estado, uid, targetUid, ctx) {
  exigir(estado.fase === "resultado", "Fuera de tiempo");
  exigir(estado.ruletaEfecto === 5, "No hay mamón que pasar");
  exigir(estado.peorUid === uid, "No te toca pasarlo");
  if (targetUid === uid) throw new ReglaError("No puedes pasártelo a ti");
  exigir(jugador(estado, targetUid), "Jugador inválido");

  girarRuletaPara(estado, targetUid, 3, ctx);
  // La fase sigue en 'resultado': refrescar el deadline a mano para que dé
  // tiempo a ver la ruleta re-girar en el nuevo objetivo.
  estado.faseHasta = ctx.now() + 25_000;
}
