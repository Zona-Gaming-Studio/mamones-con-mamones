// Cliente WebSocket hacia la SalaDO (Durable Object). No sabe nada de React:
// es un emisor plano con reconexión, heartbeat y cola de envío.
//
// Adaptado del matchClient de distrito-game, con dos refuerzos que un juego
// por turnos necesita:
// - **Cola de envío**: una acción despachada durante un parpadeo de red no se
//   descarta en silencio; se encola y sale al reconectar (el servidor valida
//   igual, así que una acción ya vencida solo produce un {t:'error'}).
// - **Heartbeat**: ping periódico y, si la conexión lleva demasiado callada,
//   se fuerza el cierre para que la reconexión traiga un snapshot fresco
//   (los sockets zombis de iOS/PWA en background no siempre emiten 'close').
//
// La identidad viaja en la cookie de sesión durante el upgrade; el Worker la
// verifica y la estampa hacia el DO. Reconectar re-sincroniza solo: el DO
// manda el snapshot completo al aceptar el socket.
import { API_BASE } from "./api.js";

const PING_MS = 25_000;
const SILENCIO_MAX_MS = 70_000;
const COLA_MAX = 20;

export class SalaClient {
  constructor(codigo) {
    this.codigo = codigo;
    this.ws = null;
    this.retries = 0;
    this.cerradoAdrede = false;
    this.cola = [];
    this.ultimoSnapshot = null;
    this.ultimoMensajeEn = 0;
    this.listeners = { snapshot: new Set(), mensaje: new Set(), conexion: new Set() };
    this.pingTimer = null;
    this.onVisible = () => {
      // Al volver del background: si el socket murió sin avisar, reconectar ya.
      if (document.visibilityState !== "visible" || this.cerradoAdrede) return;
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
        this.retries = 0;
        this.connect();
      }
    };
  }

  // tipo: 'snapshot' (recibe el snapshot) | 'mensaje' (chat/reaccion/error)
  //     | 'conexion' ("connecting" | "open" | "closed"). Devuelve el des-suscriptor.
  on(tipo, cb) {
    this.listeners[tipo].add(cb);
    return () => this.listeners[tipo].delete(cb);
  }

  emit(tipo, dato) {
    for (const cb of this.listeners[tipo]) cb(dato);
  }

  connect() {
    this.cerradoAdrede = false;
    this.emit("conexion", "connecting");
    const base = API_BASE.replace(/^http/, "ws");
    const ws = new WebSocket(`${base}/salas/${encodeURIComponent(this.codigo)}/ws`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.retries = 0;
      this.ultimoMensajeEn = Date.now();
      this.emit("conexion", "open");
      const pendientes = this.cola.splice(0);
      for (const msg of pendientes) this.enviar(msg);
      this.armarPing();
      document.addEventListener("visibilitychange", this.onVisible);
    });

    ws.addEventListener("message", (e) => {
      this.ultimoMensajeEn = Date.now();
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return; // mensaje no-JSON: ignorar
      }
      if (msg.t === "pong") return;
      if (msg.t === "snapshot") {
        this.ultimoSnapshot = msg;
        this.emit("snapshot", msg);
      } else {
        this.emit("mensaje", msg);
      }
    });

    ws.addEventListener("close", () => {
      this.desarmarPing();
      this.emit("conexion", "closed");
      if (!this.cerradoAdrede) this.reconnect();
    });

    ws.addEventListener("error", () => ws.close());
  }

  reconnect() {
    const espera = Math.min(1000 * 2 ** this.retries, 8000);
    this.retries += 1;
    setTimeout(() => {
      if (!this.cerradoAdrede) this.connect();
    }, espera);
  }

  armarPing() {
    this.desarmarPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.ultimoMensajeEn > SILENCIO_MAX_MS) {
        this.ws.close(); // zombi: forzar el ciclo de reconexión
        return;
      }
      this.ws.send('{"t":"ping"}');
    }, PING_MS);
  }

  desarmarPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  enviar(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else if (!this.cerradoAdrede && this.cola.length < COLA_MAX) {
      this.cola.push(msg);
    }
  }

  close() {
    this.cerradoAdrede = true;
    this.desarmarPing();
    document.removeEventListener("visibilitychange", this.onVisible);
    this.cola = [];
    this.ws?.close();
    this.ws = null;
  }
}
