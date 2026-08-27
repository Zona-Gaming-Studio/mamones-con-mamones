/**
 * `SalaDO` — el Durable Object autoritativo, una instancia por sala de juego.
 *
 * Es un cascarón fino sobre el motor de reglas (`src/rules/`): recibe acciones
 * por WebSocket, las aplica al estado, persiste y difunde a cada jugador SU
 * vista censurada (`snapshotPara`). Reemplaza a las RPC SECURITY DEFINER + RLS
 * + Realtime + polling del esquema Supabase original.
 *
 *  - **Hibernation API**: la identidad viaja en el attachment del socket; nada
 *    en memoria sobrevive a la hibernación, así que todo handler empieza con
 *    `load()` y el estado completo vive en storage bajo una sola clave (toda
 *    escritura es atómica).
 *  - **Alarms**: `estado.faseHasta` ES la alarm. Los timeouts los resuelve el
 *    reloj del servidor (ex `resolver_timeout` que los clientes disparaban por
 *    polling cada 3 s).
 *  - **Identidad**: el Worker verifica la sesión y estampa `X-User-Id`; el DO
 *    confía en ese header y en nada más (solo es alcanzable a través del
 *    Worker).
 *  - **Presencia**: el ciclo de vida real de los WebSockets reemplaza a
 *    Presence + `marcar_conectados` (y cierra el hueco de que cualquier
 *    cliente marcara conectados a toda la sala).
 */
import { DurableObject } from "cloudflare:workers";
import {
  ReglaError,
  abandonarSala,
  aplicar,
  crearEstado,
  jugador,
  marcarConexion,
  resolverTimeout,
  snapshotPara,
  unirseSala,
} from "../src/rules/index.js";
import { ACCIONES_WS, EFIMEROS_WS } from "../src/net/protocol.js";
// Mazo empaquetado (el mismo de PR #2, idéntico al del single-player). En la
// Fase 3/5 pasa a leerse de D1 (edición en vivo desde el panel admin) con este
// JSON como fallback.
import mazoBase from "../src/game/data/cartas.json";

const ESTADO_KEY = "estado";
export const USER_HEADER = "X-User-Id";

type Estado = ReturnType<typeof crearEstado>;
type Resultado = { ok: boolean; error?: string; codigo?: string };

export class SalaDO extends DurableObject<Env> {
  private estado: Estado | null = null;
  private cargado = false;

  private async load(): Promise<void> {
    if (this.cargado) return;
    this.estado = (await this.ctx.storage.get<Estado>(ESTADO_KEY)) ?? null;
    this.cargado = true;
  }

  private async persist(): Promise<void> {
    if (this.estado) await this.ctx.storage.put(ESTADO_KEY, this.estado);
  }

  private reglasCtx() {
    return { now: () => Date.now(), rng: Math.random };
  }

  /** Tras cada mutación: persistir, sincronizar la alarm con faseHasta y difundir. */
  private async alDia(): Promise<void> {
    await this.persist();
    if (this.estado?.faseHasta != null) {
      await this.ctx.storage.setAlarm(this.estado.faseHasta);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
    this.difundir();
  }

  private difundir(): void {
    if (!this.estado) return;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as { uid?: string } | null;
      if (!att?.uid) continue;
      try {
        ws.send(JSON.stringify({ t: "snapshot", ...snapshotPara(this.estado, att.uid) }));
      } catch {
        // socket muerto: su webSocketClose/Error hará la limpieza
      }
    }
  }

  private enviarError(ws: WebSocket, mensaje: string): void {
    try {
      ws.send(JSON.stringify({ t: "error", mensaje }));
    } catch {
      /* socket muerto */
    }
  }

  // ── RPC desde el Worker ─────────────────────────────────────────────────────

  /** Crea la sala. Falla si el código ya está en uso (el Worker reintenta con otro). */
  async crear(args: { codigo: string; uid: string; nombre: string }): Promise<Resultado> {
    await this.load();
    if (this.estado) return { ok: false, error: "ya-existe" };
    this.estado = crearEstado(args.codigo, args.uid, args.nombre);
    await this.persist();
    return { ok: true, codigo: args.codigo };
  }

  /**
   * Entra a la sala (solo en lobby) o valida el regreso de un jugador que ya
   * estaba (reconexión en cualquier fase: el `conectado` real lo fija el WS).
   */
  async unirse(args: { uid: string; nombre: string }): Promise<Resultado> {
    await this.load();
    if (!this.estado) return { ok: false, error: "Sala no encontrada" };
    if (!jugador(this.estado, args.uid)) {
      try {
        unirseSala(this.estado, args.uid, args.nombre);
      } catch (e) {
        if (e instanceof ReglaError) return { ok: false, error: e.message };
        throw e;
      }
      await this.alDia();
    }
    return { ok: true, codigo: this.estado.codigo };
  }

  // ── WebSocket (hibernation) ─────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    await this.load();
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("se espera una conexión WebSocket", { status: 426 });
    }
    const uid = request.headers.get(USER_HEADER) ?? "";
    if (!uid) return new Response("sesión no válida", { status: 401 });
    if (!this.estado) return new Response("la sala no existe", { status: 404 });
    if (!jugador(this.estado, uid)) return new Response("no estás en la sala", { status: 403 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [uid]);
    server.serializeAttachment({ uid });

    marcarConexion(this.estado, uid, true, this.reglasCtx());
    await this.alDia(); // difunde: el socket recién aceptado ya recibe su snapshot
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.load();
    if (!this.estado) return;

    let msg: { t?: string } & Record<string, unknown>;
    try {
      msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      return this.enviarError(ws, "mensaje inválido");
    }
    const uid = (ws.deserializeAttachment() as { uid?: string } | null)?.uid ?? "";
    if (!uid || !msg.t) return;

    // Chat y reacciones: relay efímero a toda la sala, sin tocar el estado
    // (mismo contrato que el broadcast de Realtime que reemplazan).
    if (EFIMEROS_WS.includes(msg.t)) {
      const payload = JSON.stringify({ ...msg, uid });
      for (const s of this.ctx.getWebSockets()) {
        try {
          s.send(payload);
        } catch {
          /* socket muerto */
        }
      }
      return;
    }

    if (msg.t === "abandonar") {
      const vacia = abandonarSala(this.estado, uid, this.reglasCtx());
      for (const s of this.ctx.getWebSockets(uid)) {
        try {
          s.close(1000, "saliste de la sala");
        } catch {
          /* ya cerrado */
        }
      }
      if (vacia) {
        this.estado = null;
        await this.ctx.storage.deleteAll();
        await this.ctx.storage.deleteAlarm();
        return;
      }
      await this.alDia();
      return;
    }

    if (ACCIONES_WS.includes(msg.t)) {
      try {
        const accion = { ...msg, tipo: msg.t, uid };
        if (msg.t === "iniciar") (accion as Record<string, unknown>).mazo = mazoBase;
        aplicar(this.estado, accion, this.reglasCtx());
      } catch (e) {
        if (e instanceof ReglaError) return this.enviarError(ws, e.message);
        throw e;
      }
      await this.alDia();
      return;
    }

    this.enviarError(ws, `mensaje desconocido: ${msg.t}`);
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1006 ? 1000 : code, "cierre");
    } catch {
      /* ya cerrado */
    }
    await this.desconectar(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.desconectar(ws);
  }

  private async desconectar(ws: WebSocket): Promise<void> {
    await this.load();
    if (!this.estado) return;
    const uid = (ws.deserializeAttachment() as { uid?: string } | null)?.uid;
    if (!uid || !jugador(this.estado, uid)) return;
    // Con otra pestaña/socket vivo del mismo jugador, sigue conectado.
    if (this.ctx.getWebSockets(uid).some((s) => s !== ws)) return;
    marcarConexion(this.estado, uid, false, this.reglasCtx());
    await this.alDia();
  }

  // ── Reloj (alarm) → ex resolver_timeout ─────────────────────────────────────

  override async alarm(): Promise<void> {
    await this.load();
    if (!this.estado) return;
    resolverTimeout(this.estado, this.reglasCtx());
    await this.alDia(); // re-arma con el nuevo deadline (o la cancela)
  }

  // ── Seams de test (mismo patrón que distrito-game: probar sin sockets) ──────

  async snapshotRpc(uid: string) {
    await this.load();
    return this.estado ? snapshotPara(this.estado, uid) : null;
  }

  async accionRpc(uid: string, accion: Record<string, unknown>): Promise<Resultado> {
    await this.load();
    if (!this.estado) return { ok: false, error: "Sala no encontrada" };
    try {
      const completa = { ...accion, uid };
      if (accion.tipo === "iniciar" && !completa.mazo) completa.mazo = mazoBase;
      aplicar(this.estado, completa, this.reglasCtx());
    } catch (e) {
      if (e instanceof ReglaError) return { ok: false, error: e.message };
      throw e;
    }
    await this.alDia();
    return { ok: true };
  }

  async alarmProgramadaRpc(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }

  /**
   * Solo tests: retrocede el deadline para simular el paso del tiempo. NO
   * re-arma la alarm (quedaría en el pasado y workerd la dispararía sola,
   * compitiendo con runDurableObjectAlarm): el test la fuerza él mismo.
   */
  async adelantarRelojRpc(ms: number): Promise<void> {
    await this.load();
    if (!this.estado || this.estado.faseHasta == null) return;
    this.estado.faseHasta -= ms;
    await this.persist();
  }
}
