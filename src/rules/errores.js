// Equivalente del `raise exception` de las RPC: una validación rechazada.
// El DO la captura y la devuelve al cliente como mensaje de error; cualquier
// otro throw es un bug del motor.
export class ReglaError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "ReglaError";
  }
}

export function exigir(cond, mensaje) {
  if (!cond) throw new ReglaError(mensaje);
}
