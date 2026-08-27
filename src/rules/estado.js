// Forma del estado de una sala y transiciones de fase.
//
// El estado es UN objeto JSON-serializable que absorbe las tablas `salas`,
// `jugadores_sala`, `cartas_mano` y `mesa_juego` del esquema Supabase original.
// Las funciones del motor lo MUTAN en sitio y son deterministas dado
// (estado, accion, ctx) con ctx = { now: () => msEpoch, rng: () => [0,1) }.
// Tiempos en ms de epoch. La identidad de una carta es su TEXTO (herencia del
// esquema original: manos y mesa guardan el texto, no un id).

// Duraciones de fase en ms (ex-trigger tg_salas_fase_hasta).
export const DURACIONES = {
  jugando: 60_000,
  juzgando: 45_000,
  resultado: 25_000,
};

export const MANO_SIZE = 7;
export const MIN_JUGADORES = 4;
export const MAX_JUGADORES = 10;

// Ex crear_sala: sala en lobby con el host como jugador orden 0. El código lo
// genera el llamador (el Worker direcciona el DO por código, así que la
// unicidad se resuelve fuera del motor).
export function crearEstado(codigo, hostUid, nombre) {
  return {
    codigo,
    fase: "lobby",
    ronda: 0,
    hostUid,
    juezUid: null,
    cartaVerde: null,
    config: { modo: "clasica", piensaRapido: false, meta: null },
    metaCongelada: null, // fijada en iniciarPartida; la meta no cambia en vivo
    verdesUsadas: [], // ex salas.mazo_verde (verdes ya salidas en la partida)
    descarteRojas: [], // ex salas.mazo_rojo (rojas quemadas en la partida)
    faseHasta: null,
    rondaInicio: null,
    penalizadoUid: null,
    mejorMesaId: null,
    peorUid: null,
    ruletaEfecto: null, // 1..6
    historial: [], // {ronda, verde, roja, ganadorUid, ganador}
    jugadores: [crearJugador(hostUid, nombre, 0)],
    manos: {}, // uid -> [texto, ...]
    mesa: [], // {id, ronda, jugadorUid, carta, esGanadora, jugadaEn}
    mazo: { rojas: [], verdes: [] }, // catálogo activo, snapshot en iniciarPartida
    seq: 0, // ids de jugadas de mesa
  };
}

export function crearJugador(uid, nombre, orden) {
  return {
    uid,
    nombre,
    puntos: 0,
    orden,
    conectado: true,
    efectoActivo: null, // pendiente: se activa en la próxima avanzarRonda
    efectoRonda: null, // activo esta ronda (lo lee el cliente); también 'sin_turno'
    congeladoHasta: null,
    cartasAJugar: 1,
  };
}

export function jugador(estado, uid) {
  return estado.jugadores.find((j) => j.uid === uid) ?? null;
}

export function mano(estado, uid) {
  return (estado.manos[uid] ??= []);
}

export function jugadasRonda(estado, uid = null) {
  return estado.mesa.filter(
    (m) => m.ronda === estado.ronda && (uid === null || m.jugadorUid === uid)
  );
}

// Cambio de fase con deadline (ex-trigger): solo re-fija el reloj si la fase
// realmente cambia; quien necesite refrescarlo sin cambiar de fase (avanzarRonda
// jugando→jugando, pasarMamon) escribe faseHasta explícito después.
export function transicionar(estado, fase, ctx) {
  if (estado.fase === fase) return;
  estado.fase = fase;
  estado.faseHasta = fase in DURACIONES ? ctx.now() + DURACIONES[fase] : null;
  if (fase === "jugando") estado.rondaInicio = ctx.now();
}

// Cuántas jugadas cierran la fase de envíos y cuántas van: ambas cuentan SOLO a
// los conectados no-Juez. (Corrige el port: el SQL contaba las filas de mesa de
// desconectados contra el esperado de conectados, y reparar_sala ignoraba
// cartas_a_jugar — cierres prematuros con desconexiones o jugada doble.)
export function esperadasRonda(estado) {
  return estado.jugadores
    .filter((j) => j.conectado && j.uid !== estado.juezUid)
    .reduce((sum, j) => sum + j.cartasAJugar, 0);
}

export function jugadasQueCuentan(estado) {
  const conectados = new Set(
    estado.jugadores.filter((j) => j.conectado).map((j) => j.uid)
  );
  return jugadasRonda(estado).filter(
    (m) => conectados.has(m.jugadorUid) && m.jugadorUid !== estado.juezUid
  ).length;
}

export function debeCerrarJugadas(estado) {
  const esperadas = esperadasRonda(estado);
  return esperadas > 0 && jugadasQueCuentan(estado) >= esperadas;
}
