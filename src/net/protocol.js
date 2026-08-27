// Protocolo cliente ↔ servidor del multijugador (compartido por el Worker/DO y
// el cliente React). Mantenerlo en un solo módulo evita el drift que antes
// cubrían los tipos generados de Supabase.
//
// HTTP (Worker):
//   POST /api/salas                 {nombre}  → {ok, codigo}
//   POST /api/salas/:codigo/join    {nombre}  → {ok, codigo} | {ok:false, error}
//   GET  /salas/:codigo/ws                    → upgrade WebSocket
//
// WS cliente → servidor (mensajes planos, `t` = tipo):
//   Acciones de juego (van al motor de reglas con el uid de la sesión):
//     {t:'set_config', modo, piensaRapido, meta}
//     {t:'iniciar'} {t:'jugar_carta', carta} {t:'elegir_ganadora', mesaId}
//     {t:'elegir_peor', mesaId} {t:'pasar_mamon', targetUid}
//     {t:'siguiente_ronda'} {t:'reiniciar'}
//   Ciclo de vida y efímeros:
//     {t:'abandonar'}  {t:'chat', ...payload}  {t:'reaccion', ...payload}
//
// WS servidor → cliente:
//   {t:'snapshot', sala, meta, jugadores, mesa, jugaron, misJugadas, mano}
//     (la vista censurada por jugador — ver src/rules/vista.js)
//   {t:'error', mensaje}          validación rechazada, para mostrar al jugador
//   {t:'chat'|'reaccion', uid, ...payload}   relay efímero, sin persistir

// Acciones WS que despacha el motor (ver ACCIONES en src/rules/index.js).
export const ACCIONES_WS = [
  "set_config",
  "iniciar",
  "jugar_carta",
  "elegir_ganadora",
  "elegir_peor",
  "pasar_mamon",
  "siguiente_ronda",
  "reiniciar",
];

export const EFIMEROS_WS = ["chat", "reaccion"];
