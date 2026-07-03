import { lazy, Suspense, useEffect, useState } from "react";
import Menu from "./ui/Menu.jsx";
import Lobby from "./ui/Lobby.jsx";
import Splash from "./ui/Splash.jsx";
import { ensureAuth } from "./lib/supabase.js";

// Code-splitting: Phaser (~1.4 MB) y el panel admin salen del bundle principal.
// El menú/lobby cargan y responden sin pagar ese peso; el chunk del juego se
// precalienta en segundo plano (y la PWA lo precachea igual).
const PhaserGame = lazy(() => import("./game/PhaserGame.jsx"));
const Admin = lazy(() => import("./ui/Admin.jsx"));

// ¿Se pidió el panel admin? (?admin en la URL). Se conserva el parámetro para
// que un refresh o la vuelta del OAuth de Google sigan mostrando el panel.
const ES_ADMIN = (() => {
  try {
    return new URLSearchParams(window.location.search).has("admin");
  } catch {
    return false;
  }
})();

// Lee ?sala=CODIGO de la URL (enlace de invitación) una sola vez y lo limpia.
function leerInvitacion() {
  try {
    const code = new URLSearchParams(window.location.search).get("sala");
    if (!code) return "";
    const url = new URL(window.location.href);
    url.searchParams.delete("sala");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    return code.trim().toUpperCase().slice(0, 6);
  } catch {
    return "";
  }
}
const INVITACION = leerInvitacion();

// Pantallas: "menu" | "sp" (single-player) | "lobby" (multijugador).
export default function App() {
  const [splash, setSplash] = useState(!ES_ADMIN);
  const [screen, setScreen] = useState(ES_ADMIN ? "admin" : INVITACION ? "lobby" : "menu");
  const [gameConfig, setGameConfig] = useState(null);

  // Precalentar en el arranque: sesión anónima lista antes de entrar al lobby
  // (evita el "Iniciando sesión…") y el chunk de Phaser tras el splash.
  useEffect(() => {
    if (ES_ADMIN) return;
    ensureAuth().catch(() => {});
    const t = setTimeout(() => import("./game/PhaserGame.jsx"), 2500);
    return () => clearTimeout(t);
  }, []);

  const volverAlMenu = () => {
    setGameConfig(null);
    setScreen("menu");
  };

  let content;
  if (screen === "sp" && gameConfig) {
    content = (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <PhaserGame config={gameConfig} onExit={volverAlMenu} />
        <button
          onClick={volverAlMenu}
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            zIndex: 10,
            background: "rgba(12,33,20,0.85)",
            color: "var(--text-light)",
            border: "1px solid var(--panel-border)",
            borderRadius: 10,
            padding: "8px 14px",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          ← Menú
        </button>
      </div>
    );
  } else if (screen === "lobby") {
    content = <Lobby initialCode={INVITACION} onBack={() => setScreen("menu")} />;
  } else if (screen === "admin") {
    content = <Admin onBack={() => setScreen("menu")} />;
  } else {
    content = (
      <Menu
        onStart={(config) => {
          setGameConfig(config);
          setScreen("sp");
        }}
        onMultiplayer={() => setScreen("lobby")}
      />
    );
  }

  return (
    <>
      <Suspense
        fallback={
          <p style={{ margin: "auto", color: "var(--text-muted)", fontWeight: 700 }}>Cargando…</p>
        }
      >
        {content}
      </Suspense>
      {splash && <Splash onDone={() => setSplash(false)} />}
    </>
  );
}
