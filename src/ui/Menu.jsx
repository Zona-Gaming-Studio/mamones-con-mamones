import { useState } from "react";
import ComoJugar from "./ComoJugar.jsx";
import AcercaDe from "./AcercaDe.jsx";
import "./Menu.css";

const PIENSA_RAPIDO_INFO =
  "El último en escoger su carta no juega esa ronda: la carta se le regresa a la mano.";

const MODES = [
  {
    id: "clasica",
    name: "Clásica",
    desc: "El modo de siempre: el Juez elige la carta roja que mejor le pega al adjetivo.",
  },
  {
    id: "amarga",
    name: "Amarga",
    desc: "El Juez elige la mejor y la PEOR; quien saca la peor gira La Ruleta del Mamón Amargo.",
    badge: "Beta",
  },
];

const PLAYER_OPTIONS = [4, 5, 6];

// Iconos SVG inline (trazos de Feather/Lucide, MIT) — nada de emojis como iconos.
const IcoGlobo = () => (
  <svg className="btn__ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);
const IcoLibro = () => (
  <svg className="btn__ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);
const IcoInfo = () => (
  <svg className="btn__ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);

export default function Menu({ onStart, onMultiplayer }) {
  const [step, setStep] = useState("home"); // home | create
  const [mode, setMode] = useState("clasica");
  const [players, setPlayers] = useState(4); // total: tú + bots
  const [piensaRapido, setPiensaRapido] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showComo, setShowComo] = useState(false);
  const [showAcerca, setShowAcerca] = useState(false);

  const piensaDisponible = players > 5; // regla del online: solo con más de 5

  return (
    <div className="menu">
      <div className="menu__panel">
        <h1 className="menu__title">
          <img className="menu__logo" src="/assets/logo.png" alt="Mamones con Mamones" />
        </h1>

        {step === "home" && (
          <div className="menu__buttons">
            {/* Modo estrella destacado como card (jerarquía del prototipo): un solo CTA dorado. */}
            <div className="menu__solo">
              <div className="menu__solo-head">
                <span className="menu__solo-title">Jugar solo</span>
                <span className="menu__solo-desc">Tú contra bots, en este dispositivo</span>
              </div>
              <button className="btn btn--primary" onClick={() => setStep("create")}>
                Crear partida
              </button>
            </div>
            <button className="btn btn--row" onClick={onMultiplayer}>
              <IcoGlobo />
              <span className="btn__text">Multijugador</span>
              <span className="badge-beta">Beta</span>
            </button>
            <button className="btn btn--row" onClick={() => setShowComo(true)}>
              <IcoLibro />
              <span className="btn__text">Cómo jugar</span>
            </button>
            <button className="btn btn--row" onClick={() => setShowAcerca(true)}>
              <IcoInfo />
              <span className="btn__text">Acerca de</span>
            </button>
          </div>
        )}

        {step === "create" && (
          <div className="create">
            <section className="create__card">
              <p className="create__label">Jugadores (tú + bots)</p>
              <div className="pcount">
                {PLAYER_OPTIONS.map((n) => (
                  <button
                    key={n}
                    className={`pcount__btn ${players === n ? "pcount__btn--active" : ""}`}
                    onClick={() => setPlayers(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </section>

            <section className="create__card">
              <p className="create__label">Modo de juego</p>
              <div className="modes">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    className={`mode ${mode === m.id ? "mode--active" : ""}`}
                    onClick={() => setMode(m.id)}
                  >
                    <span className="mode__name">
                      {m.name}
                      {m.badge && <span className="mode__badge">{m.badge}</span>}
                    </span>
                    <span className="mode__desc">{m.desc}</span>
                  </button>
                ))}
              </div>

              <div className="toggle-row">
                <label className={`toggle ${piensaDisponible ? "" : "toggle--off"}`}>
                  <input
                    type="checkbox"
                    checked={piensaRapido && piensaDisponible}
                    disabled={!piensaDisponible}
                    onChange={(e) => setPiensaRapido(e.target.checked)}
                  />
                  <span className="toggle__track">
                    <span className="toggle__thumb" />
                  </span>
                  <span className="toggle__text">Activar piensa rápido</span>
                </label>

                <span
                  className="info"
                  tabIndex={0}
                  onMouseEnter={() => setShowInfo(true)}
                  onMouseLeave={() => setShowInfo(false)}
                  onClick={() => setShowInfo((v) => !v)}
                  onFocus={() => setShowInfo(true)}
                  onBlur={() => setShowInfo(false)}
                  aria-label={PIENSA_RAPIDO_INFO}
                >
                  i
                  {showInfo && <span className="info__tip">{PIENSA_RAPIDO_INFO}</span>}
                </span>
              </div>
              {!piensaDisponible && (
                <p className="create__note">Piensa rápido requiere más de 5 jugadores.</p>
              )}
            </section>

            <div className="create__actions">
              <button className="btn btn--ghost" onClick={() => setStep("home")}>
                ← Volver
              </button>
              <button
                className="btn btn--primary"
                onClick={() =>
                  onStart({ mode, players, piensaRapido: piensaRapido && piensaDisponible })
                }
              >
                Comenzar
              </button>
            </div>
          </div>
        )}
      </div>

      {showComo && <ComoJugar onClose={() => setShowComo(false)} />}
      {showAcerca && <AcercaDe onClose={() => setShowAcerca(false)} />}
    </div>
  );
}
