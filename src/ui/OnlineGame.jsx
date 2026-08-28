import { useEffect, useRef, useState } from "react";
import { apiGet } from "../net/api.js";
import { initSfx, isSfxEnabled, setSfxEnabled, spinTicks, beep, beepUrge, ding } from "../lib/sfx.js";
import Recap from "./Recap.jsx";
import CartaArte from "./CartaArte.jsx";
import "./OnlineGame.css";

// ¿El dispositivo tiene mouse con hover? (escritorio sí, móvil táctil no)
const CAN_HOVER =
  typeof window !== "undefined" && window.matchMedia && window.matchMedia("(hover: hover)").matches;

// ¿El usuario pidió movimiento reducido? (acorta ruleta/cartas volando y calla los tics)
const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function metaGanar(n) {
  if (n >= 8) return 4;
  if (n === 7) return 5;
  if (n === 6) return 6;
  if (n === 5) return 7;
  return 8;
}

// Posición de la carta 'i' dentro del montoncito del centro (leve desorden).
function pileCardStyle(i) {
  const ox = ((i * 37) % 15) - 7;
  const oy = ((i * 23) % 11) - 5;
  const rot = ((i * 29) % 21) - 10;
  return {
    transform: `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px)) rotate(${rot}deg) scale(0.8)`,
    zIndex: i,
  };
}

const EFECTOS = {
  1: { emoji: "👀", name: "Pela el ojo", desc: "Mano boca abajo: espía y juega de memoria." },
  2: { emoji: "🥶", name: "Mano congelada", desc: "10 segundos sin poder jugar." },
  3: { emoji: "🌪️", name: "Mazo barajado", desc: "¡Mano nueva al azar!" },
  4: { emoji: "⏳", name: "A ciegas", desc: "Juegas sin ver el adjetivo verde." },
  5: { emoji: "🤢", name: "Pasa el mamón", desc: "¡Salvado! Pásaselo a otro." },
  6: { emoji: "🃏", name: "Jugada doble", desc: "Juegas DOS cartas." },
};

// Color de la cuña de cada efecto en la ruleta.
const COLOR_EFECTO = {
  1: "#ffd35c",
  2: "#8a1c10",
  3: "#2e8b2e",
  4: "#e08a1c",
  5: "#3a6ea5",
  6: "#6b3fa0",
};

// Efectos que entran al sorteo. 'Mano congelada' (2) solo con Piensa Rápido.
const efectosRuleta = (piensaRapido) =>
  piensaRapido ? [1, 2, 3, 4, 5, 6] : [1, 3, 4, 5, 6];

// Reacciones disponibles sobre las cartas jugadas (emoji + nombre accesible).
const REACCIONES = [
  { emoji: "👏", nombre: "aplauso" },
  { emoji: "😂", nombre: "risa" },
  { emoji: "🤢", nombre: "asco" },
  { emoji: "🔥", nombre: "fuego" },
  { emoji: "❤️", nombre: "corazón" },
];

function Carta({ color, titulo, flavor, onClick, onDoubleClick, disabled, ganadora, peor, anon, onLongPress, onLongPressEnd, style }) {
  const timer = useRef(null);
  const longRef = useRef(false);

  const startPress = () => {
    longRef.current = false;
    if (anon || !flavor) return; // nada que ampliar
    timer.current = setTimeout(() => {
      longRef.current = true;
      onLongPress && onLongPress({ color, titulo, flavor });
    }, 400);
  };
  const endPress = () => {
    if (timer.current) clearTimeout(timer.current);
    if (longRef.current) onLongPressEnd && onLongPressEnd();
  };
  const handleClick = (e) => {
    if (longRef.current) {
      longRef.current = false;
      return; // fue pulsación larga: no dispares el clic
    }
    onClick && onClick(e);
  };

  const cls = `carta carta--${color} ${ganadora ? "carta--gana" : ""} ${peor ? "carta--peor" : ""} ${
    disabled ? "carta--off" : ""
  } ${onClick || onDoubleClick ? "carta--click" : ""}`;

  return (
    <button
      className={cls}
      style={style}
      onClick={handleClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onMouseEnter={() => CAN_HOVER && !anon && flavor && onLongPress && onLongPress({ color, titulo, flavor })}
      onMouseLeave={() => CAN_HOVER && onLongPressEnd && onLongPressEnd()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <CartaArte color={color} texto={titulo} flavor={flavor} anon={anon} />
    </button>
  );
}

export default function OnlineGame({ cliente, uid, codigo, onLeave }) {
  const [sala, setSala] = useState(null);
  const [metaSrv, setMetaSrv] = useState(null); // meta congelada por el server
  const [players, setPlayers] = useState([]);
  const [hand, setHand] = useState([]);
  const [handView, setHandView] = useState("abanico"); // "abanico" (encimadas) | "completas"
  const [mesa, setMesa] = useState([]);
  const [flavores, setFlavores] = useState({});
  const [jugaron, setJugaron] = useState([]);
  const [misJugadas, setMisJugadas] = useState(0);
  const [nowTs, setNowTs] = useState(Date.now());
  const [error, setError] = useState("");
  const [peek, setPeek] = useState({}); // índices "espiados" (pela el ojo)
  const [rot, setRot] = useState(0); // rotación de la ruleta
  const [verRes, setVerRes] = useState(false); // mostrar resultado de la ruleta
  const [muted, setMuted] = useState(!isSfxEnabled());
  const [preview, setPreview] = useState(null); // carta ampliada (long-press)
  const [flying, setFlying] = useState(null); // carta volando al centro de la mesa
  const [myPlayed, setMyPlayed] = useState([]); // tus cartas ya en el montoncito (esta ronda)
  const [chat, setChat] = useState([]); // mensajes de la sala (efímeros, por broadcast)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [reactions, setReactions] = useState([]); // emojis flotando sobre cartas
  const [reactFor, setReactFor] = useState(null); // id de mesa con el picker abierto
  const cerrarPreview = () => setPreview(null);
  const turnsRef = useRef(5);
  const dingRef = useRef("");
  const rootRef = useRef(null);
  const chatOpenRef = useRef(false);
  const chatEndRef = useRef(null);

  useEffect(() => initSfx(), []);
  const toggleMute = () => {
    const v = !muted;
    setMuted(v);
    setSfxEnabled(!v);
  };

  const fase = sala?.fase;
  const ronda = sala?.ronda;
  const modo = sala?.config?.modo || "clasica";
  const piensaRapido = !!sala?.config?.piensaRapido;
  const esJuez = sala?.juez_uid === uid;
  const cartaVerde = sala?.carta_verde;
  const mejorMesaId = sala?.mejor_mesa_id;
  const peorUid = sala?.peor_uid;
  const ruletaEfecto = sala?.ruleta_efecto;

  // Sectores de la ruleta (5 ó 6 según Piensa Rápido), repartidos parejo.
  const efectosActivos = efectosRuleta(piensaRapido);
  const segDeg = 360 / efectosActivos.length;
  const ruletaBg = `conic-gradient(${efectosActivos
    .map((e, idx) => `${COLOR_EFECTO[e]} ${idx * segDeg}deg ${(idx + 1) * segDeg}deg`)
    .join(", ")})`;

  const me = players.find((p) => p.uid === uid);
  const miEfecto = me?.efecto_ronda;
  const cartasAJugar = me?.cartas_a_jugar ?? 1;
  const congeladoHasta = me?.congelado_hasta ?? null; // ms de epoch (snapshot)
  const congelado = congeladoHasta && congeladoHasta > nowTs;
  const congSecs = congelado ? Math.ceil((congeladoHasta - nowTs) / 1000) : 0;
  const yaJugue = misJugadas >= cartasAJugar;
  const meta = metaSrv ?? (sala?.config?.meta || metaGanar(players.length));

  const deadline = sala?.fase_hasta ?? null; // ms de epoch (snapshot)
  const secsLeft = deadline ? Math.max(0, Math.ceil((deadline - nowTs) / 1000)) : null;

  // Tic de 1s.
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Catálogo texto → flavor (para el pie de las cartas y el long-press).
  useEffect(() => {
    apiGet("/api/cartas")
      .then(({ cartas }) => {
        const m = {};
        (cartas || []).forEach((c) => (m[c.texto] = c.flavor));
        setFlavores(m);
      })
      .catch(() => {});
  }, []);

  // El estado llega EMPUJADO por el WebSocket: un snapshot censurado por
  // jugador tras cada mutación (reemplaza los seis fetches + Realtime + el
  // polling de 3s; los timeouts los resuelve la alarm del servidor solo).
  useEffect(() => {
    const aplicar = (s) => {
      setSala({
        fase: s.sala.fase,
        ronda: s.sala.ronda,
        config: s.sala.config,
        juez_uid: s.sala.juezUid,
        carta_verde: s.sala.cartaVerde,
        mejor_mesa_id: s.sala.mejorMesaId,
        peor_uid: s.sala.peorUid,
        ruleta_efecto: s.sala.ruletaEfecto,
        fase_hasta: s.sala.faseHasta,
        host_uid: s.sala.hostUid,
        historial: s.sala.historial,
      });
      setMetaSrv(s.meta ?? null);
      setPlayers(
        s.jugadores
          .slice()
          .sort((a, b) => a.orden - b.orden)
          .map((j) => ({
            uid: j.uid,
            nombre: j.nombre,
            puntos: j.puntos,
            orden: j.orden,
            efecto_ronda: j.efectoRonda,
            cartas_a_jugar: j.cartasAJugar,
            congelado_hasta: j.congeladoHasta,
          }))
      );
      setHand(s.mano);
      setMesa(
        s.mesa.map((m) => ({
          id: m.id,
          carta: m.carta,
          es_ganadora: m.esGanadora,
          jugador_uid: m.jugadorUid,
          nombre: m.nombre,
        }))
      );
      setJugaron(s.jugaron);
      setMisJugadas(s.misJugadas.length);
    };

    const offSnap = cliente.on("snapshot", aplicar);
    const offMsg = cliente.on("mensaje", (m) => {
      if (m.t === "error") setError(m.mensaje);
      else if (m.t === "chat") {
        if (m.uid === uid) return; // el propio ya se pintó optimista
        setChat((c) => [...c.slice(-59), m]);
        if (!chatOpenRef.current) setChatUnread((u) => u + 1);
      } else if (m.t === "reaccion") {
        if (m.uid === uid) return;
        mostrarReaccion(m.mesaId, m.emoji);
      }
    });
    if (cliente.ultimoSnapshot) aplicar(cliente.ultimoSnapshot);

    return () => {
      offSnap();
      offMsg();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente, uid]);

  // Reiniciar "peek" y el montoncito propio cuando cambia la ronda.
  useEffect(() => {
    setPeek({});
    setMyPlayed([]);
  }, [ronda]);

  // Chat: al abrir, marca leído; auto-scroll al último mensaje.
  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (chatOpen) setChatUnread(0);
  }, [chatOpen]);
  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [chat, chatOpen]);

  // Animación de la ruleta (modo Amargo, en resultado).
  useEffect(() => {
    if (fase === "resultado" && ruletaEfecto) {
      turnsRef.current += 5;
      const idx = Math.max(0, efectosActivos.indexOf(ruletaEfecto));
      const target = 360 * turnsRef.current - (idx * segDeg + segDeg / 2);
      setVerRes(false);
      // Diferir la rotación final un par de frames: en móvil, si el ángulo
      // objetivo se aplica en el mismo frame en que monta la rueda, el navegador
      // pinta directo el ángulo final y la transición CSS no dispara (no gira).
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setRot(target));
      });
      // Con movimiento reducido: sin giro largo ni tics; el resultado casi de inmediato.
      const spinMs = REDUCED_MOTION ? 200 : 2600;
      if (!REDUCED_MOTION) spinTicks(spinMs);
      const t = setTimeout(() => setVerRes(true), spinMs);
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
        clearTimeout(t);
      };
    }
  }, [fase, ruletaEfecto, peorUid, piensaRapido]);

  // Beep del reloj en los últimos segundos.
  useEffect(() => {
    if (secsLeft == null || !["jugando", "juzgando", "resultado"].includes(fase)) return;
    if (secsLeft > 0 && secsLeft <= 5) (secsLeft <= 3 ? beepUrge : beep)();
  }, [secsLeft, fase]);

  // Ding al revelarse el resultado de la ronda.
  useEffect(() => {
    if (fase === "resultado" && dingRef.current !== String(ronda)) {
      dingRef.current = String(ronda);
      ding();
    }
  }, [fase, ronda]);

  // --- Intenciones ---
  // Van por el WebSocket; una validación rechazada vuelve como {t:'error'}.
  const enviar = (msg) => {
    setError("");
    cliente.enviar(msg);
  };
  const jugar = (carta) => {
    enviar({ t: "jugar_carta", carta });
    setMisJugadas((n) => n + 1); // optimista
  };
  // Juega animando la carta en arco desde la mano hasta el montoncito del centro.
  const jugarConAnim = (carta, el) => {
    if (!el || !rootRef.current) return jugar(carta);
    const r = el.getBoundingClientRect();
    const cont = rootRef.current.getBoundingClientRect();
    const dx = cont.left + cont.width / 2 - (r.left + r.width / 2);
    const dy = cont.top + cont.height * 0.4 - (r.top + r.height / 2);
    setFlying({ carta, flavor: flavores[carta], left: r.left, top: r.top, w: r.width, h: r.height, dx, dy });
    setHand((h) => h.filter((c) => c !== carta)); // quítala de la mano al instante
    jugar(carta);
    // Al aterrizar, la carta se queda en el montoncito (boca arriba, es tuya).
    setTimeout(() => {
      setMyPlayed((m) => [...m, carta]);
      setFlying(null);
    }, REDUCED_MOTION ? 0 : 520);
  };
  // --- Chat y reacciones (efímeros, vía broadcast del canal) ---
  const uid7 = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const mostrarReaccion = (mesaId, emoji) => {
    const id = uid7();
    setReactions((r) => [...r, { id, mesaId, emoji }]);
    setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 1400);
  };
  const enviarChat = () => {
    const text = chatInput.trim().slice(0, 200);
    if (!text) return;
    const msg = { id: uid7(), uid, nombre: me?.nombre || "Tú", text };
    cliente.enviar({ t: "chat", ...msg });
    setChat((c) => [...c.slice(-59), msg]); // optimista (el eco propio se filtra)
    setChatInput("");
  };
  const enviarReaccion = (mesaId, emoji) => {
    cliente.enviar({ t: "reaccion", mesaId, emoji });
    mostrarReaccion(mesaId, emoji); // optimista (el eco propio se filtra)
    setReactFor(null);
  };

  const elegirGanadora = (id) => enviar({ t: "elegir_ganadora", mesaId: id });
  const elegirPeor = (id) => enviar({ t: "elegir_peor", mesaId: id });
  const pasar = (target) => enviar({ t: "pasar_mamon", targetUid: target });
  const siguiente = () => enviar({ t: "siguiente_ronda" });
  const reiniciar = () => enviar({ t: "reiniciar" });
  // El abandono real (mensaje + cierre del socket) vive en el salir del Lobby.
  const salir = () => onLeave();

  if (!sala) {
    return (
      <div className="og og--loading">
        <p className="og__banner">Conectando con la sala…</p>
      </div>
    );
  }

  // --- Estado / banner ---
  const juezNombre = players.find((p) => p.uid === sala.juez_uid)?.nombre || "…";
  const faceDown = miEfecto === "pela_el_ojo" && fase === "jugando" && !esJuez;
  const blindGreen = miEfecto === "jugar_a_ciegas" && fase === "jugando" && !esJuez && !yaJugue;
  const pasoPeor = modo === "amarga" && !!mejorMesaId;

  let banner = "";
  if (fase === "jugando") {
    if (esJuez) banner = "Eres el Juez. Esperando jugadas…";
    else if (cartasAJugar === 0) banner = "⏳ Esta ronda no envías carta (te demoraste como Juez).";
    else if (congelado) banner = `🥶 Mano congelada… ${congSecs}s`;
    else if (yaJugue) banner = "Ya jugaste. Esperando a los demás…";
    else if (cartasAJugar > 1) banner = `🃏 Jugada doble: juega ${cartasAJugar - misJugadas} carta(s).`;
    else if (blindGreen) banner = "⏳ A ciegas: juega SIN ver el adjetivo.";
    else if (faceDown) banner = "👀 Boca abajo: clic para espiar, doble clic para jugar.";
    else banner = "Elige una carta de tu mano.";
  } else if (fase === "juzgando") {
    if (esJuez) banner = modo === "amarga" ? (pasoPeor ? "Elige la PEOR carta 🤢" : "Elige la MEJOR carta 🏆") : "Elige la carta ganadora.";
    else banner = `${juezNombre} (Juez) está decidiendo…`;
  } else if (fase === "resultado") {
    const g = mesa.find((m) => m.es_ganadora);
    banner = g ? `Ganó: ${g.nombre} con "${g.carta}"` : "Resultado de la ronda";
  } else if (fase === "terminado") {
    const campeon = [...players].sort((a, b) => b.puntos - a.puntos)[0];
    banner = `🏆 ¡${campeon?.nombre} gana la partida!`;
  }

  const puedeAvanzar = fase === "resultado" && (sala.host_uid === uid || esJuez);
  const enMesa = fase === "juzgando" || fase === "resultado" || fase === "terminado";
  const otrosEnMesa = jugaron.filter((u) => u !== uid).length; // rivales que ya jugaron
  const muestraPila = fase === "jugando" && (myPlayed.length > 0 || otrosEnMesa > 0);
  const fx = ruletaEfecto ? EFECTOS[ruletaEfecto] : null;
  const peorNombre = players.find((p) => p.uid === peorUid)?.nombre || "alguien";
  const muestraRuleta = fase === "resultado" && modo === "amarga" && !!ruletaEfecto;

  return (
    <div className="og" ref={rootRef}>
      <header className="og__top">
        <span className="og__code">Sala {codigo}</span>
        <span className="og__meta">
          {modo === "amarga" ? "Amargo 🍋" : "Clásico 🟢"}
          {piensaRapido ? " · ⚡" : ""} · Ronda {ronda} · Meta {meta}
        </span>
        <span className="og__topbtns">
          <button
            className="og__mute og__chatbtn"
            onClick={() => setChatOpen((v) => !v)}
            title="Chat"
            aria-label={chatUnread > 0 ? `Chat (${chatUnread} sin leer)` : "Chat de la sala"}
            aria-expanded={chatOpen}
          >
            💬
            {chatUnread > 0 && <span className="og__badge">{chatUnread > 9 ? "9+" : chatUnread}</span>}
          </button>
          <button
            className="og__mute"
            onClick={toggleMute}
            title="Sonido"
            aria-label={muted ? "Activar sonido" : "Silenciar"}
            aria-pressed={muted}
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button className="og__leave" onClick={salir}>
            ← Salir
          </button>
        </span>
      </header>

      <div className="og__scores">
        {players.map((p) => {
          const isJuez = p.uid === sala.juez_uid;
          const yo = p.uid === uid;
          const jugo = jugaron.includes(p.uid);
          let estado = null;
          if (isJuez) estado = "⚖️ Juez";
          else if (fase === "jugando") estado = jugo ? "✓ jugó" : "pensando…";
          return (
            <span key={p.uid} className={`chip ${isJuez ? "chip--juez" : ""} ${yo ? "chip--yo" : ""}`}>
              <b className="chip__pts">{p.puntos}</b>
              <span className="chip__name">
                {p.nombre}
                {yo ? " (tú)" : ""}
              </span>
              {estado && <span className="chip__estado">{estado}</span>}
            </span>
          );
        })}
      </div>

      <div className="og__green">
        {blindGreen ? (
          <div className="carta carta--verde carta--oculta">
            <span className="carta__dorso">🟢 ?</span>
          </div>
        ) : (
          <Carta
            color="verde"
            titulo={cartaVerde}
            flavor={flavores[cartaVerde]}
            onLongPress={setPreview}
            onLongPressEnd={cerrarPreview}
          />
        )}
      </div>

      <p className="og__banner">
        {/* Live region solo sobre el texto de fase: el reloj queda fuera para no anunciar cada segundo. */}
        <span aria-live="polite">{banner}</span>
        {secsLeft != null && ["jugando", "juzgando", "resultado"].includes(fase) && (
          <span
            className={`og__clock ${secsLeft <= 10 ? "og__clock--urge" : ""} ${
              secsLeft > 0 && secsLeft <= 5 ? "og__clock--blink" : ""
            }`}
          >
            {" "}
            · ⏱ {secsLeft}s
          </span>
        )}
      </p>
      {error && (
        <p className="og__error" role="alert">
          {error}
        </p>
      )}
      {["juzgando", "resultado"].includes(fase) && piensaRapido && !esJuez && misJugadas === 0 && (
        <p className="og__nota">🐢 Te pasaste de lento: esta ronda tu carta se quedó en la mano.</p>
      )}

      {/* Ruleta del Mamón Amargo */}
      {muestraRuleta && (
        <div className="ruleta">
          <div className="ruleta__pointer" />
          <div className="ruleta__wheel" style={{ transform: `rotate(${rot}deg)`, background: ruletaBg }}>
            {efectosActivos.map((e, idx) => (
              <span
                key={e}
                className="ruleta__seg"
                style={{ transform: `rotate(${idx * segDeg + segDeg / 2}deg) translateY(-54px)` }}
              >
                {EFECTOS[e].emoji}
              </span>
            ))}
            <span className="ruleta__hub" />
          </div>
          {verRes && fx && (
            <div className="ruleta__res">
              <span className="ruleta__quien">
                {peorNombre} {peorUid === uid ? "(¡tú!)" : ""} sacó:
              </span>
              <span className="ruleta__name">
                {fx.emoji} {fx.name}
              </span>
              <span className="ruleta__desc">{fx.desc}</span>
              {peorUid === uid && ruletaEfecto === 5 && (
                <div className="ruleta__pasar">
                  <span>Pásaselo a:</span>
                  <div className="ruleta__targets">
                    {players
                      .filter((p) => p.uid !== uid)
                      .map((p) => (
                        <button key={p.uid} className="og__leave2" onClick={() => pasar(p.uid)}>
                          {p.nombre}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {puedeAvanzar && (
        <button className="og__next" onClick={siguiente}>
          Siguiente ronda →
        </button>
      )}

      {/* Jugadas en el centro */}
      {enMesa && (
        <div className="og__mesa">
          {mesa.map((m) => {
            const esMejor = m.es_ganadora || m.id === mejorMesaId;
            const esPeor = fase === "resultado" && m.jugador_uid && m.jugador_uid === peorUid;
            const clickable = fase === "juzgando" && esJuez && !(pasoPeor && m.id === mejorMesaId);
            const handler = clickable ? () => (pasoPeor ? elegirPeor(m.id) : elegirGanadora(m.id)) : undefined;
            return (
              <div key={m.id} className="og__jugada">
                <Carta
                  color="roja"
                  titulo={m.carta}
                  flavor={flavores[m.carta]}
                  ganadora={esMejor}
                  peor={esPeor}
                  onClick={handler}
                  onLongPress={setPreview}
                  onLongPressEnd={cerrarPreview}
                />

                {/* Emojis flotando sobre la carta */}
                {reactions
                  .filter((r) => r.mesaId === m.id)
                  .map((r) => (
                    <span key={r.id} className="og__reactfloat">
                      {r.emoji}
                    </span>
                  ))}

                {/* Reaccionar a la carta */}
                <button
                  className="og__reactbtn"
                  onClick={() => setReactFor(reactFor === m.id ? null : m.id)}
                  title="Reaccionar"
                  aria-label="Reaccionar a esta carta"
                  aria-expanded={reactFor === m.id}
                >
                  😀
                </button>
                {reactFor === m.id && (
                  <div className="og__reactpick">
                    {REACCIONES.map((r) => (
                      <button
                        key={r.emoji}
                        onClick={() => enviarReaccion(m.id, r.emoji)}
                        aria-label={`Reaccionar con ${r.nombre}`}
                      >
                        {r.emoji}
                      </button>
                    ))}
                  </div>
                )}

                {m.nombre && <span className="og__autor">{m.nombre}</span>}
              </div>
            );
          })}
        </div>
      )}

      {fase === "terminado" && (
        <Recap
          campeon={[...players].sort((a, b) => b.puntos - a.puntos)[0]?.nombre}
          standings={[...players]
            .sort((a, b) => b.puntos - a.puntos)
            .map((p) => ({ nombre: p.nombre, rondas: p.puntos, yo: p.uid === uid }))}
          rondas={sala.historial || []}
          onReplay={sala.host_uid === uid ? reiniciar : null}
          replayLabel="Jugar otra vez"
          onLeave={salir}
          leaveLabel="Salir de la sala"
        />
      )}

      {/* Mano del jugador */}
      {!esJuez && fase !== "terminado" && (
        <div className="og__hand">
          <div className="og__handhdr">
            <p className="og__handtab">Tu mano</p>
            <button
              type="button"
              className="og__handtoggle"
              onClick={() => setHandView((v) => (v === "abanico" ? "completas" : "abanico"))}
              aria-label="Cambiar vista de la mano"
            >
              {handView === "abanico" ? "🃏 Abanico" : "🂠 Completas"}
            </button>
          </div>
          <p className="og__handhint">Mantén pulsada una carta para leerla</p>
          <div className={`og__handrow og__handrow--${handView}`} style={{ "--n": hand.length }}>
            {(() => {
              const puedeJugar = fase === "jugando" && !yaJugue && !congelado;
              // Cada carta va envuelta en un .og__slot (caja-pivote fija): en abanico la carta
              // interior flota al hover sin mover la caja (sin flicker); en completas es el pivote del reparto.
              const slot = (c, i) => (
                <div className="og__slot" style={{ "--i": i, "--n": hand.length }} key={c}>
                  {faceDown ? (
                    <Carta
                      color="roja"
                      titulo={c}
                      flavor={flavores[c]}
                      anon={!peek[i]}
                      onClick={() => setPeek((p) => (p[i] ? {} : { [i]: true }))}
                      onDoubleClick={puedeJugar ? (e) => jugarConAnim(c, e.currentTarget) : undefined}
                      onLongPress={setPreview}
                      onLongPressEnd={cerrarPreview}
                    />
                  ) : (
                    <Carta
                      color="roja"
                      titulo={c}
                      flavor={flavores[c]}
                      onClick={puedeJugar ? (e) => jugarConAnim(c, e.currentTarget) : undefined}
                      disabled={!puedeJugar}
                      onLongPress={setPreview}
                      onLongPressEnd={cerrarPreview}
                    />
                  )}
                </div>
              );
              // Completas: dos líneas, la de arriba con más cartas (7→4/3, 8→4/4, 9→5/4…)
              if (handView === "completas") {
                const topN = Math.ceil(hand.length / 2);
                return (
                  <>
                    <div className="og__handline">{hand.slice(0, topN).map((c, k) => slot(c, k))}</div>
                    {hand.length > topN && (
                      <div className="og__handline">{hand.slice(topN).map((c, k) => slot(c, topN + k))}</div>
                    )}
                  </>
                );
              }
              // Abanico: lista plana de slots (posicionados en arco por CSS)
              return hand.map((c, i) => slot(c, i));
            })()}
          </div>
        </div>
      )}

      {/* Vista ampliada al mantener pulsada una carta.
          El overlay tiene pointer-events:none (el cierre vive en el endPress de la carta),
          así que no lleva handlers propios. */}
      {preview && (
        <div className="og__preview">
          <div className={`carta carta--${preview.color} og__preview-card`}>
            <CartaArte color={preview.color} texto={preview.titulo} flavor={preview.flavor} />
          </div>
        </div>
      )}

      {/* Montoncito de cartas jugadas (durante la ronda) */}
      {muestraPila && (
        <div className="og__pile">
          {myPlayed.map((c, i) => (
            <div key={`me-${i}`} className="og__pilecard" style={pileCardStyle(i)}>
              <div className="carta carta--roja">
                <CartaArte color="roja" texto={c} flavor={flavores[c]} />
              </div>
            </div>
          ))}
          {Array.from({ length: otrosEnMesa }).map((_, i) => (
            <div
              key={`o-${i}`}
              className="og__pilecard"
              style={pileCardStyle(myPlayed.length + i)}
            >
              <div className="carta carta--roja">
                <CartaArte color="roja" anon />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Carta volando en arco al montoncito al jugarla */}
      {flying && (
        <div
          className="og__fly"
          style={{
            left: flying.left,
            top: flying.top,
            width: flying.w,
            height: flying.h,
            "--dx": `${flying.dx}px`,
            "--dy": `${flying.dy}px`,
          }}
        >
          <div className="carta carta--roja">
            <CartaArte color="roja" texto={flying.carta} flavor={flying.flavor} />
          </div>
        </div>
      )}

      {/* Chat de la sala (efímero) */}
      {chatOpen && (
        <div className="og__chat">
          <div className="og__chat-head">
            <span>💬 Chat de la sala</span>
            <button className="og__chat-x" onClick={() => setChatOpen(false)} aria-label="Cerrar">
              ✕
            </button>
          </div>
          <div className="og__chat-log">
            {chat.length === 0 && <p className="og__chat-empty">Aún no hay mensajes. ¡Saluda! 👋</p>}
            {chat.map((m) => (
              <div key={m.id} className={`og__msg ${m.uid === uid ? "og__msg--yo" : ""}`}>
                {m.uid !== uid && <span className="og__msg-name">{m.nombre}</span>}
                <span className="og__msg-text">{m.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form
            className="og__chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              enviarChat();
            }}
          >
            <input
              className="og__chat-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              maxLength={200}
              placeholder="Escribe un mensaje…"
            />
            <button className="og__chat-send" type="submit" aria-label="Enviar">
              ➤
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
