import Phaser from "phaser";
import Preloader from "./scenes/Preloader.js";
import GameScene from "./scenes/GameScene.js";
import cartas from "./data/cartas.json";

// Diseño FIJO (mobile-first, retrato 9:16). El layout se calcula una sola vez a esta
// resolución y Phaser escala TODO el canvas con Scale.FIT para caber en cualquier
// pantalla (uniforme, sin reflow → nunca se rompe). El backing 1080×1920 es alta
// resolución, así que también se ve nítido sin manejar DPR a mano. Las barras de
// letterbox (donde la proporción no calza) van en verde fieltro → se disimulan.
export const DESIGN_W = 1080;
export const DESIGN_H = 1920;

export function createGame(parent, gameConfig) {
  const config = {
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#10301d", // = fieltro inferior: disimula el letterbox
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: DESIGN_W,
      height: DESIGN_H,
    },
    scene: [Preloader, GameScene],
  };

  const game = new Phaser.Game(config);
  game.registry.set("cartas", cartas);
  game.registry.set("gameConfig", gameConfig || { mode: "clasica", piensaRapido: false });
  return game;
}
