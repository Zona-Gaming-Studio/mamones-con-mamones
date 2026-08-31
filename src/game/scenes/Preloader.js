// Escena de carga: muestra el wordmark + "Cargando..." y precarga la marca + las
// fuentes de las cartas POR CAPAS (para que las primeras cartas salgan ya con fuente).
import Phaser from "phaser";
import { cardFontsReady, embeddedFontCSS } from "../../ui/cardTexture.js";

export default class Preloader extends Phaser.Scene {
  constructor() {
    super({ key: "Preloader" });
  }

  preload() {
    this.load.image("logo", "assets/logo.png"); // marca (menú/carga)
    this.load.image("wordmark", "assets/wordmark.webp"); // logo de texto (pantalla de carga)
    this.load.image("papelera", "assets/papelera.webp"); // zona de descarte (Juez, Clásica)
    this.load.image("corona", "assets/corona.webp"); // carta ganadora (resultado)
    // Las cartas ahora son POR CAPAS: sus texturas se rasterizan bajo demanda en
    // GameScene desde public/assets/cartas + las fuentes self-hosted. Los mazos
    // (cartas.json) llegan por el registry del juego, no por el loader.
  }

  create() {
    const { width, height } = this.scale;
    const dpr = width / 400; // diseño fijo 1080×1920 (ver config.js)

    // Wordmark centrado, escalado para caber SIEMPRE dentro de la pantalla (sin cortar).
    const cy = height * 0.46;
    const logo = this.add.image(width / 2, cy, "wordmark").setOrigin(0.5);
    const s = Math.min((width * 0.82) / logo.width, (height * 0.36) / logo.height);
    logo.setScale(s);

    this.add
      .text(width / 2, cy + logo.displayHeight / 2 + 34 * dpr, "Cargando...", {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: `${Math.round(20 * dpr)}px`,
        color: "#9fd6a3",
      })
      .setOrigin(0.5);

    // Precargar las fuentes de las cartas (Bebas/Teko + Montserrat) Y las de la UI antes
    // de entrar: el texto de Phaser se rasteriza una vez, así que deben estar listas.
    const uiFonts = document.fonts
      ? Promise.all([
          document.fonts.load('400 40px "Montserrat"'),
          document.fonts.load('600 40px "Montserrat"'),
          document.fonts.load('700 40px "Montserrat"'),
          document.fonts.load('400 40px "Bebas Neue"'),
        ]).then(() => document.fonts.ready)
      : Promise.resolve();
    Promise.all([cardFontsReady, embeddedFontCSS(), uiFonts])
      .catch(() => {})
      .finally(() => this.time.delayedCall(300, () => this.scene.start("GameScene")));
  }
}
