// Lobby, membresía, configuración y reparación por conectividad.

import { exigir } from "./errores.js";
import {
  MAX_JUGADORES,
  crearJugador,
  debeCerrarJugadas,
  jugador,
  jugadasRonda,
  mano,
  transicionar,
} from "./estado.js";

// Ex unirse_sala: reconecta si ya estaba; si no, entra con el siguiente orden.
export function unirseSala(estado, uid, nombre) {
  exigir(estado.fase === "lobby", "La partida ya empezó");

  const existente = jugador(estado, uid);
  if (existente) {
    existente.conectado = true;
    existente.nombre = nombre;
    return;
  }

  // Aforo por jugadores presentes (corrige el port: el SQL usaba max(orden)+1,
  // que nunca se reutiliza, y una sala con rotación de gente se "llenaba" sola).
  exigir(estado.jugadores.length < MAX_JUGADORES, `Sala llena (máximo ${MAX_JUGADORES})`);
  const orden = Math.max(-1, ...estado.jugadores.map((j) => j.orden)) + 1;
  estado.jugadores.push(crearJugador(uid, nombre, orden));
}

// Ex set_config_sala: solo host, solo en lobby. Sobrescribe la config entera.
export function setConfigSala(estado, uid, { modo, piensaRapido, meta }) {
  exigir(estado.hostUid === uid, "Solo el host configura la sala");
  exigir(estado.fase === "lobby", "La partida ya empezó");
  exigir(modo === "clasica" || modo === "amarga", "Modo inválido");
  exigir(meta == null || (meta >= 1 && meta <= 20), "Meta fuera de rango");

  estado.config = {
    modo,
    // Piensa Rápido solo con más de 5 jugadores.
    piensaRapido: Boolean(piensaRapido) && estado.jugadores.length > 5,
    meta: meta ?? null,
  };
}

// Ex abandonar_sala. Devuelve true si la sala quedó vacía (el llamador la
// destruye). Las cartas del que se va se queman al descarte (corrige el port:
// el SQL las devolvía en silencio al pool disponible).
export function abandonarSala(estado, uid, ctx) {
  estado.descarteRojas.push(...mano(estado, uid));
  delete estado.manos[uid];
  const jugadasPropias = jugadasRonda(estado, uid);
  estado.descarteRojas.push(...jugadasPropias.map((m) => m.carta));
  estado.mesa = estado.mesa.filter((m) => !jugadasPropias.includes(m));
  estado.jugadores = estado.jugadores.filter((j) => j.uid !== uid);

  if (!estado.jugadores.length) return true;
  repararSala(estado, ctx);
  return false;
}

// Reemplazo de Presence + marcar_conectados: el DO reporta el ciclo de vida
// real de cada WebSocket. Marca y repara.
export function marcarConexion(estado, uid, conectado, ctx) {
  const j = jugador(estado, uid);
  if (!j) return;
  j.conectado = conectado;
  repararSala(estado, ctx);
}

// Ex reparar_sala: auto-sanación según quién está conectado.
//  1) migra el host si se fue;  2) con <2 activos en juego, pausa a lobby
//  (conservando puntos);  3) reasigna el Juez desconectado (devolviéndole al
//  nuevo Juez las cartas que hubiera jugado);  4) desbloquea el cierre de
//  jugadas si ya jugaron todos los conectados que debían.
export function repararSala(estado, ctx) {
  const conectados = estado.jugadores
    .filter((j) => j.conectado)
    .sort((a, b) => a.orden - b.orden);

  const host = jugador(estado, estado.hostUid);
  if ((!host || !host.conectado) && conectados.length) {
    estado.hostUid = conectados[0].uid;
  }

  if (!conectados.length) return;
  if (estado.fase !== "jugando" && estado.fase !== "juzgando") return;

  if (conectados.length < 2) {
    estado.ronda = 0;
    estado.juezUid = null;
    estado.cartaVerde = null;
    transicionar(estado, "lobby", ctx);
    return;
  }

  const juez = jugador(estado, estado.juezUid);
  if (!juez || !juez.conectado) {
    const nuevo = conectados[0].uid;
    // El Juez no compite: si el nuevo ya había jugado, recupera sus cartas.
    const jugadas = jugadasRonda(estado, nuevo);
    for (const m of jugadas) mano(estado, nuevo).push(m.carta);
    estado.mesa = estado.mesa.filter((m) => !jugadas.includes(m));
    estado.juezUid = nuevo;
  }

  if (estado.fase === "jugando" && debeCerrarJugadas(estado)) {
    transicionar(estado, "juzgando", ctx);
    estado.mejorMesaId = null;
  }
}
