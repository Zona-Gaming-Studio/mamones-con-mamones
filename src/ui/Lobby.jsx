import { useEffect, useRef, useState } from "react";
import { ensureAuth } from "../lib/auth.js";
import { apiPost } from "../net/api.js";
import { SalaClient } from "../net/salaClient.js";
import OnlineGame from "./OnlineGame.jsx";
import TopBar from "./TopBar.jsx";
import "./Lobby.css";

const MIN_JUGADORES = 4;

// Iconos SVG inline (trazos de Feather/Lucide, MIT).
const IcoCopiar = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const IcoCheck = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export default function Lobby({ onBack, initialCode }) {
  const [uid, setUid] = useState(null);
  const [nombre, setNombre] = useState(() => localStorage.getItem("mcm_nombre") || "");
  const [codigoInput, setCodigoInput] = useState((initialCode || "").toUpperCase());
  const [room, setRoom] = useState(null); // { codigo }
  const [cliente, setCliente] = useState(null); // SalaClient (WS hacia la SalaDO)
  const [players, setPlayers] = useState([]); // conectados (para la lista y los gates)
  const [fase, setFase] = useState("lobby");
  const [config, setConfig] = useState({ modo: "clasica", piensaRapido: false, meta: null });
  const [hostUid, setHostUid] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [codigoCopiado, setCodigoCopiado] = useState(false);
  const clienteRef = useRef(null);

  const isHost = hostUid === uid;

  const entrarSala = (codigo) => {
    localStorage.setItem("mcm_room", JSON.stringify({ codigo }));
    setFase("lobby");
    setRoom({ codigo });
  };

  useEffect(() => {
    ensureAuth()
      .then((u) => setUid(u.id))
      .catch((e) => setError("No se pudo iniciar sesión: " + e.message));
  }, []);

  // Reconexión: si quedó una sala guardada, reentrar (el join del server acepta
  // a un miembro en cualquier fase y rechaza al resto si la partida empezó).
  // Si llegamos por un enlace de invitación, esa sala tiene prioridad.
  const reconexionRef = useRef(false);
  useEffect(() => {
    if (!uid || room || initialCode || reconexionRef.current) return;
    reconexionRef.current = true;
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem("mcm_room") || "null");
    } catch {
      saved = null;
    }
    if (!saved?.codigo) return localStorage.removeItem("mcm_room");
    (async () => {
      try {
        await apiPost(`/api/salas/${saved.codigo}/join`, { nombre: nombre.trim() || "Jugador" });
        setRoom({ codigo: saved.codigo });
      } catch {
        localStorage.removeItem("mcm_room"); // sala muerta o partida ajena en curso
      }
    })();
  }, [uid, room, initialCode, nombre]);

  // Dentro de la sala: UNA conexión WebSocket para lobby y tablero (se pasa a
  // OnlineGame). El snapshot trae fase, config, host y jugadores; la presencia
  // es el campo `conectado` que mantiene el ciclo de vida real de los sockets.
  useEffect(() => {
    if (!room || !uid) return;
    const cli = new SalaClient(room.codigo);
    clienteRef.current = cli;
    setCliente(cli);

    const offSnap = cli.on("snapshot", (s) => {
      setFase(s.sala.fase);
      setHostUid(s.sala.hostUid);
      if (s.sala.config) setConfig(s.sala.config);
      setPlayers(s.jugadores.filter((j) => j.conectado));
    });
    const offMsg = cli.on("mensaje", (m) => {
      if (m.t === "error") setError(m.mensaje);
    });
    cli.connect();

    return () => {
      offSnap();
      offMsg();
      cli.close();
      clienteRef.current = null;
      setCliente(null);
      setPlayers([]);
    };
  }, [room, uid]);

  const guardarNombre = (v) => {
    setNombre(v);
    localStorage.setItem("mcm_nombre", v);
  };

  const crearSala = async () => {
    if (!nombre.trim()) return setError("Escribe tu nombre primero.");
    setError("");
    setBusy(true);
    try {
      const { codigo } = await apiPost("/api/salas", { nombre: nombre.trim() });
      setHostUid(uid); // el creador es host
      entrarSala(codigo);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const unirseSala = async () => {
    if (!nombre.trim()) return setError("Escribe tu nombre primero.");
    if (!codigoInput.trim()) return setError("Escribe el código de la sala.");
    setError("");
    setBusy(true);
    const code = codigoInput.trim().toUpperCase();
    try {
      await apiPost(`/api/salas/${code}/join`, { nombre: nombre.trim() });
      entrarSala(code);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // El host actualiza la config; el snapshot difundido se la muestra a todos.
  const guardarConfig = (cambios) => {
    const c = { modo: "clasica", piensaRapido: false, meta: null, ...config, ...cambios };
    setConfig(c); // optimista
    clienteRef.current?.enviar({
      t: "set_config",
      modo: c.modo,
      piensaRapido: !!c.piensaRapido,
      meta: c.meta ?? null,
    });
  };
  const elegirModo = (modo) => guardarConfig({ modo });
  const togglePiensa = () => guardarConfig({ piensaRapido: !config.piensaRapido });
  const elegirMeta = (meta) => guardarConfig({ meta });

  const iniciarPartida = () => {
    setError("");
    clienteRef.current?.enviar({ t: "iniciar" });
  };

  // Comparte un enlace de invitación (Web Share API) o lo copia al portapapeles.
  const compartirInvitacion = async () => {
    const url = `${window.location.origin}/?sala=${room.codigo}`;
    const texto = `¡Únete a mi sala de Mamones con Mamones! 🍋\nCódigo: ${room.codigo}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Mamones con Mamones", text: texto, url });
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return; // el usuario canceló el diálogo
      // cualquier otro fallo: caemos al portapapeles
    }
    try {
      await navigator.clipboard.writeText(`${texto}\n${url}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setError(`No se pudo compartir. Dicta el código: ${room.codigo}`);
    }
  };

  // Copia solo el código (para dictarlo/pegarlo), aparte del enlace de invitación.
  const copiarCodigo = async () => {
    try {
      await navigator.clipboard.writeText(room.codigo);
      setCodigoCopiado(true);
      setTimeout(() => setCodigoCopiado(false), 2000);
    } catch {
      /* sin permiso de portapapeles: el código está a la vista igual */
    }
  };

  const salir = () => {
    clienteRef.current?.enviar({ t: "abandonar" });
    localStorage.removeItem("mcm_room");
    setRoom(null);
    setFase("lobby");
    setHostUid(null);
    setError("");
  };

  // ---- Partida en curso: tablero online ----
  if (room && fase !== "lobby" && cliente) {
    return <OnlineGame cliente={cliente} uid={uid} codigo={room.codigo} onLeave={salir} />;
  }

  // ---- En sala, esperando el inicio ----
  if (room) {
    const hostNombre = players.find((p) => p.uid === hostUid)?.nombre;
    return (
      <div className="lobby">
        <TopBar
          narrow
          onBack={salir}
          backLabel="Salir de la sala"
          eyebrow="Lobby"
          title={hostNombre ? `Sala de ${hostNombre}` : `Sala ${room.codigo}`}
        />
        <div className="lobby__scroll">
        <div className="lobby__panel">
          {/* Card de código (hero del prototipo): eyebrow + código gigante + copiar + invitar. */}
          <div className="roomcard">
            <p className="lobby__eyebrow">Código de sala</p>
            <div className="roomcard__row">
              <h1 className="lobby__code">{room.codigo}</h1>
              <button
                className="copybtn"
                onClick={copiarCodigo}
                title="Copiar código"
                aria-label={codigoCopiado ? "Código copiado" : "Copiar código"}
              >
                {codigoCopiado ? <IcoCheck /> : <IcoCopiar />}
              </button>
            </div>
            <button className="btn btn--invite" onClick={compartirInvitacion}>
              {copiado ? "¡Enlace copiado! ✅" : "🔗 Invitar a la sala"}
            </button>
            <p className="lobby__hint">O dicta el código para que se unan.</p>
          </div>

          <div className="players">
            <p className="players__title">
              Jugadores
              <span className="players__count">{players.length}</span>
            </p>
            {players.length === 0 && <p className="players__empty">Conectando…</p>}
            {players.map((p) => (
              <div key={p.uid} className="player">
                <span className={`player__avatar ${p.uid === uid ? "player__avatar--yo" : ""}`}>
                  {(p.nombre || "J").charAt(0).toUpperCase()}
                  <span className="player__dot" />
                </span>
                <span className="player__name">
                  {p.nombre || "Jugador"}
                  {p.uid === uid ? " (tú)" : ""}
                </span>
                {p.uid === hostUid && <span className="player__host">HOST</span>}
              </div>
            ))}
            {players.length > 0 && players.length < MIN_JUGADORES && (
              <div className="player player--wait">
                <span className="player__avatar player__avatar--ghost" aria-hidden="true" />
                <span className="player__wait">
                  Esperando jugadores… (faltan {MIN_JUGADORES - players.length})
                </span>
              </div>
            )}
          </div>

          <div className="cfg">
            <p className="cfg__title">Reglas de mesa</p>
            <p className="cfg__label">Modo de juego</p>
            {isHost ? (
              <div className="seg">
                <button
                  className={`seg__btn ${config.modo === "clasica" ? "seg__btn--active" : ""}`}
                  onClick={() => elegirModo("clasica")}
                >
                  Clásico
                </button>
                <button
                  className={`seg__btn ${config.modo === "amarga" ? "seg__btn--active" : ""}`}
                  onClick={() => elegirModo("amarga")}
                >
                  Amargo 🍋
                </button>
              </div>
            ) : (
              <p className="cfg__ro">{config.modo === "amarga" ? "Amargo 🍋" : "Clásico 🟢"}</p>
            )}

            <p className="cfg__label">Cartas para ganar</p>
            {isHost ? (
              <select
                className="cfg__select"
                value={config.meta ?? ""}
                onChange={(e) => elegirMeta(e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">Automática (según jugadores)</option>
                {[3, 4, 5, 6, 7, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>
                    {n} cartas
                  </option>
                ))}
              </select>
            ) : (
              <p className="cfg__ro">{config.meta ? `${config.meta} cartas` : "Automática"}</p>
            )}

            <div className="cfg__rapido">
              {isHost ? (
                <>
                  <label className={`switch ${players.length <= 5 ? "switch--off" : ""}`}>
                    <input
                      type="checkbox"
                      checked={!!config.piensaRapido && players.length > 5}
                      disabled={players.length <= 5}
                      onChange={togglePiensa}
                    />
                    <span className="switch__track"><span className="switch__thumb" /></span>
                    <span className="switch__text">Activar piensa rápido</span>
                  </label>
                  {players.length <= 5 && (
                    <p className="cfg__nota">Requiere más de 5 jugadores.</p>
                  )}
                </>
              ) : (
                <p className="cfg__ro">
                  Piensa rápido: {config.piensaRapido ? "Activado ⚡" : "Desactivado"}
                </p>
              )}
            </div>
          </div>

          {isHost ? (
            <button
              className="btn btn--primary"
              disabled={busy || players.length < MIN_JUGADORES}
              onClick={iniciarPartida}
            >
              {players.length < MIN_JUGADORES
                ? `Faltan ${MIN_JUGADORES - players.length} jugador(es)`
                : "Iniciar partida"}
            </button>
          ) : (
            <p className="lobby__soon">Esperando a que el host inicie la partida…</p>
          )}

          {error && <p className="lobby__error">{error}</p>}
        </div>
        </div>
      </div>
    );
  }

  // ---- Home del lobby ----
  return (
    <div className="lobby">
      <TopBar
        narrow
        onBack={onBack}
        backLabel="Volver al menú"
        eyebrow="Multijugador"
        title="Jugar en línea"
      />
      <div className="lobby__scroll">
      <div className="lobby__panel">
        {initialCode && (
          <p className="lobby__invite">
            Te invitaron a la sala <strong>{initialCode}</strong>. Escribe tu nombre y únete 👇
          </p>
        )}

        {/* El nombre aplica tanto a crear como a unirse: va arriba de las dos cards. */}
        <label className="field">
          <span className="field__label">Tu nombre</span>
          <input
            className="field__input"
            value={nombre}
            maxLength={20}
            placeholder="Ej: El Pollo"
            onChange={(e) => guardarNombre(e.target.value)}
          />
        </label>

        <section className="lcard">
          <p className="lcard__title">Crear sala nueva</p>
          <p className="lcard__desc">Abre una sala y comparte el código con tu gente.</p>
          <button className="btn btn--primary" disabled={busy || !uid} onClick={crearSala}>
            Crear partida
          </button>
        </section>

        <section className="lcard">
          <p className="lcard__title">Unirse a una sala</p>
          <label className="field">
            <span className="field__label">Código de sala</span>
            <input
              className="field__input field__input--code"
              value={codigoInput}
              maxLength={6}
              placeholder="MAMON7"
              onChange={(e) => setCodigoInput(e.target.value.toUpperCase())}
            />
          </label>
          <button className="btn" disabled={busy || !uid} onClick={unirseSala}>
            Unirse con código
          </button>
        </section>

        {error && <p className="lobby__error">{error}</p>}
        {!uid && !error && <p className="lobby__hint">Iniciando sesión…</p>}
      </div>
      </div>
    </div>
  );
}
