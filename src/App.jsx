import { useState } from "react";
import Menu from "./ui/Menu.jsx";
import Lobby from "./ui/Lobby.jsx";
import Admin from "./ui/Admin.jsx";
import PhaserGame from "./game/PhaserGame.jsx";
import Splash from "./ui/Splash.jsx";

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
      {content}
      {splash && <Splash onDone={() => setSplash(false)} />}
    </>
  );
}
