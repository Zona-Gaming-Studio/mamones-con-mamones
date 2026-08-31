// Escena principal de "Mamones con Mamones".
// Maneja el ciclo completo de una ronda:
//   1) Se revela una carta VERDE (adjetivo).
//   2) Cada jugador que NO es Juez juega una carta ROJA (el humano hace clic; los bots eligen solos).
//   3) El Juez (rota cada ronda) elige la roja ganadora.
//   4) El ganador suma un punto, se reponen las manos y rota el Juez.
//
// El layout es RESPONSIVE: todas las posiciones y tamaños se calculan en
// computeLayout() a partir del tamaño actual de la pantalla, y se recalculan
// en handleResize() cuando la ventana cambia de tamaño u orientación.
import Phaser from "phaser";
import { GameData } from "../data/cards.js";
import { cardFaceCanvas, reversoCanvas, flavorFor } from "../../ui/cardTexture.js";

const HAND_SIZE = 7;
const CARD_RATIO = 2485 / 1623; // alto/ancho de las cartas POR CAPAS (1623×2485).
// Ancho al que se rasteriza la cara/reverso. Se cachea por texto y se reusa a
// cualquier tamaño, así que se dimensiona para el uso MÁS grande: la carta del
// modal en móvil (DPR alto) llega a ~700px de dispositivo. El fondo WebP es 1080w,
// así que 640 no lo sobre-muestrea. (Ver pixelación: canvas a resolución de
// dispositivo en config.js + esta textura mayor.)
const TEX_PX = 640;

// Sistema tipográfico (mismas fuentes de las cartas, self-hosted en public/fonts):
// UI = Montserrat vertical (texto legible, nombres, mensajes); DISPLAY = Bebas Neue
// (títulos, botones, captions — mayúsculas con impacto). Precargadas en el Preloader.
const FONT_UI = "Montserrat, 'Segoe UI', system-ui, sans-serif";
const FONT_DISPLAY = "'Bebas Neue', 'Segoe UI', sans-serif";

// Movimiento reducido (paridad con el online): acorta el giro de la ruleta.
const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Meta de puntos para ganar, según cantidad de jugadores (igual que el online).
function metaGanar(n) {
  if (n >= 8) return 4;
  if (n === 7) return 5;
  if (n === 6) return 6;
  if (n === 5) return 7;
  return 8; // 4 jugadores (mínimo)
}

// Color de cada sector de la ruleta, por número de efecto (1..6).
const RULETA_COLORS = [0xffd35c, 0x8a1c10, 0x2e8b2e, 0xe08a1c, 0x3a6ea5, 0x6b3fa0];

// Paleta de la mesa.
const COLORS = {
  feltTop: 0x1f4d2e,
  feltBottom: 0x10301d,
  panel: 0x0c2114,
  panelBorder: 0x2e6b45,
  gold: 0xffd35c,
  goldHex: "#ffd35c",
  textLight: "#eaf5ec",
  textMuted: "#9fd6a3",
  dark: "#16331f",
};

// Las 6 opciones de "La Ruleta del Mamón Amargo" (modo Amarga).
const RULETA_EFFECTS = {
  1: {
    key: "pelaElOjo",
    emoji: "👀",
    name: "Pela el ojo",
    desc: "Tu mano queda boca abajo. Mantén pulsada una carta para espiarla; doble clic para jugarla de memoria.",
  },
  2: {
    key: "manoCongelada",
    emoji: "🥶",
    name: "Mano congelada",
    desc: "No podrás jugar durante los primeros 10 segundos de tu turno.",
  },
  3: {
    key: "mazoBarajado",
    emoji: "🌪️",
    name: "Mazo barajado",
    desc: "¡Adiós a tu mano! Se devuelve al mazo y recibes 7 cartas nuevas al azar.",
  },
  4: {
    key: "jugarACiegas",
    emoji: "⏳",
    name: "A ciegas",
    desc: "Eliges tu carta amarilla ANTES de que se revele el adjetivo verde.",
  },
  5: {
    key: "pasaMamon",
    emoji: "🤢",
    name: "Pasa el mamón amargo",
    desc: "¡Salvado! Pásale la ruleta a otro jugador (gira de inmediato).",
  },
  6: {
    key: "jugadaDoble",
    emoji: "🃏",
    name: "Jugada doble",
    desc: "Ventaja: esta ronda juegas DOS cartas amarillas en vez de una.",
  },
};

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
  }

  init() {
    this.greenDeck = [];
    this.redDeck = [];
    this.players = [];
    this.currentGreen = null;
    this.submissions = []; // [{ playerIndex, card }]
    this.judgeIndex = 0;
    this.phase = "play"; // play | judging | result | gameover
    this.lastResult = null; // { winnerIndex, card }
    this.round = 1;

    // --- Modo Amarga + Ruleta del Mamón Amargo ---
    this.playerEffects = []; // efectos activos por jugador
    this.judgingStep = null; // null (clásica) | "best" | "worst"
    this.bestPick = null; // jugada elegida como mejor (amarga)
    this.worstResult = null; // { loserIndex, card }
    this.pendingRoulette = null; // datos de la ruleta en curso
    this.rouletteLayer = null; // overlay animado (independiente de this.ui)
    this.rouletteWheel = null;
    this._rouletteGeom = null;
    this.playsNeeded = []; // cartas que debe jugar cada jugador esta ronda
    // Flags de efectos en curso para el turno del humano:
    this.handFrozen = false;
    this.greenRevealed = true;
    this.humanPlaysNeeded = 1;
    this.fx = { pelaElOjo: false, manoCongelada: false, jugarACiegas: false, jugadaDoble: false };
    this._lastTapTime = 0;
    this._lastTapIndex = -1;

    // Descarte de rojas de la partida (una carta jugada no reaparece hasta reiniciar).
    this.redDiscard = new Set();
    this.roundStartMs = 0;
    this.piensaRapidoVictim = null; // índice del castigado por Piensa Rápido esta ronda
    this._animatingPlay = false; // bloquea jugar mientras una carta vuela al centro
    this._pile = []; // cartas visibles en el montoncito del centro
    this._pileCount = 0; // huecos usados del montoncito (para el desorden)

    // Gesto de carta (mano o juzgar): tap→modal o arrastrar. mode "play" | "judge".
    this._cardPress = null; // { mode, i, text, card, x, y } press pendiente
    this._cardDrag = null; // { mode, i, text, card, orig } arrastre en curso
    this.confirmLayer = null; // modal genérico (independiente de this.ui)

    // Descarte del juez (Clásica): índices de submissions descartados esta ronda.
    this.discardedIdx = new Set();
    this._lastDiscarded = null; // para animar la última carta que cae al 🗑️
    this.discardZone = null; // { top, bottom, cx, w } zona de descarte (destino de arrastre)

    // La mano es siempre abanico (solape izq→der; se quitó la vista "completas").
    this._animateHandEntry = true; // anima el reparto solo al iniciar ronda
  }

  create() {
    this.computeLayout();

    // Caché de texturas de cartas POR CAPAS (cara/reverso), y de promesas en vuelo.
    this._texPromises = {};

    // Capa estática (fondo + cabecera) detrás de la capa dinámica (ui).
    this.staticLayer = this.add.container(0, 0);
    this.ui = this.add.container(0, 0);
    this.animLayer = this.add.container(0, 0); // cartas volando al centro (sobre la UI)
    this.hud = this.add.container(0, 0); // temporizador de ronda (persiste entre renders)
    this.drawStatic();

    this.setupGame();
    this.setupHandScrollInput();
    this.startRound();

    // Reorganizar todo cuando cambie el tamaño de la ventana / orientación.
    this.scale.on("resize", this.handleResize, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.handleResize, this));

    // Puente con React (PhaserGame): el recap de fin de partida se dibuja en el
    // DOM. Al pulsar "Jugar de nuevo" allí, React emite 'mcm:replay'.
    this.game.events.on("mcm:replay", this.restartGame, this);
    this.events.once("shutdown", () => this.game.events.off("mcm:replay", this.restartGame, this));
  }

  // Entrada para desplazar la mano horizontalmente (arrastre + rueda del ratón).
  // Se registra una sola vez; opera solo en la fase "play" si hay scroll activo.
  setupHandScrollInput() {
    const canScroll = () =>
      this.phase === "play" && this.handScroll && this.handScroll.enabled && this.handContainer &&
      !this.confirmLayer && !this._cardDrag;

    this.input.on("pointerdown", (p) => {
      if (!canScroll() || !this.inHandBand(p)) return;
      this._dragging = true;
      this._handDragged = false;
      this._dragStartX = p.x;
      this._dragStartScroll = this.handContainer.x;
      this._lastPointerX = p.x;
      this._handVel = 0; // agarrar detiene la inercia
    });

    this.input.on("pointermove", (p) => {
      // (1) Arrastre de una carta en curso: la carta-clon sigue el puntero.
      if (this._cardDrag) {
        this._dragCardFollow(p);
        return;
      }
      // (2) Clasificar un press pendiente sobre una carta: vertical-arriba = arrastrar
      //     para jugar; horizontal = es scroll (se descarta el press).
      if (this._cardPress) {
        const cdx = p.x - this._cardPress.x;
        const cdy = p.y - this._cardPress.y;
        if (Math.abs(cdx) > 8 || Math.abs(cdy) > 8) {
          // play = arrastrar ARRIBA (al centro); judge = arrastrar ABAJO (al 🗑️).
          const wantDir = this._cardPress.mode === "judge" ? cdy > 0 : cdy < 0;
          if (Math.abs(cdy) >= Math.abs(cdx) && wantDir) {
            this._beginCardDrag(p);
            return;
          }
          this._cardPress = null; // horizontal → deja que el scroll lo maneje
        }
      }
      // (3) Scroll horizontal de la mano.
      if (!this._dragging || !this.handContainer) return;
      const dx = p.x - this._dragStartX;
      if (Math.abs(dx) > 6) this._handDragged = true; // distinguir arrastre de toque
      // Velocidad instantánea (px por movimiento) para la inercia al soltar.
      this._handVel = p.x - this._lastPointerX;
      this._lastPointerX = p.x;
      this.handContainer.x = Phaser.Math.Clamp(
        this._dragStartScroll + dx,
        this.handScroll.min,
        this.handScroll.max
      );
      this.updateScrollThumb();
    });

    this.input.on("pointerup", (p) => {
      // (1) Soltar un arrastre de carta: sobre el centro = jugar; sobre la mano = cancelar.
      if (this._cardDrag) {
        this._endCardDrag(p);
        this._dragging = false;
        return;
      }
      // (2) Tap sobre una carta (press sin arrastre) → modal (jugar o juzgar).
      if (this._cardPress && !this._handDragged) {
        const { mode, i, text } = this._cardPress;
        this._cardPress = null;
        this._dragging = false;
        if (mode === "judge") this.openJudgeConfirm(i, text);
        else this.openPlayConfirm(i, text);
        return;
      }
      this._cardPress = null;
      this._dragging = false;
      // Limitar el "fling" inicial para que no se dispare demasiado rápido.
      this._handVel = Phaser.Math.Clamp(this._handVel || 0, -60, 60);
    });

    this.input.on("wheel", (p, objs, dx, dy) => {
      if (!canScroll()) return;
      this.handContainer.x = Phaser.Math.Clamp(
        this.handContainer.x - (dy || dx),
        this.handScroll.min,
        this.handScroll.max
      );
      this.updateScrollThumb();
    });
  }

  inHandBand(p) {
    return this.handBand && p.y >= this.handBand.top && p.y <= this.handBand.bottom;
  }

  handleResize() {
    this.computeLayout();
    this.drawStatic();
    if (this.players && this.players.length) this.render();
  }

  // Bucle de Phaser: aplica la inercia del scroll de la mano tras soltar.
  update(time, delta) {
    if (this._dragging || this.phase !== "play") return;
    if (!this.handContainer || !this.handScroll || !this.handScroll.enabled) return;
    if (!this._handVel || Math.abs(this._handVel) < 0.4) return;

    const step = this._handVel * (delta / 16.67); // independiente de los FPS
    const before = this.handContainer.x;
    this.handContainer.x = Phaser.Math.Clamp(
      before + step,
      this.handScroll.min,
      this.handScroll.max
    );

    if (this.handContainer.x === before) {
      this._handVel = 0; // llegó a un tope
    } else {
      this._handVel *= 0.93; // fricción
      if (Math.abs(this._handVel) < 0.4) this._handVel = 0;
    }
    this.updateScrollThumb();
  }

  // Calcula tamaños y anclas verticales según el tamaño actual de la pantalla.
  computeLayout() {
    // Diseño FIJO (ver config.js): W/H son 1080×1920 SIEMPRE y Phaser (Scale.FIT)
    // escala todo el canvas a la pantalla. `dpr` = cuántas veces el canvas de diseño
    // es más grande que un teléfono de referencia (REF≈400px), para escalar las
    // constantes en px "de teléfono" (topes de carta, anclas, todo lo que pasa por
    // f()) al lienzo grande. Como W es fijo, dpr y el layout son constantes.
    this.W = this.scale.width;
    this.H = this.scale.height;
    const REF = 400; // ancho de teléfono de referencia para el que se afinó el layout
    this.dpr = this.W / REF;

    this.isPortrait = this.H > this.W;

    // Escala global de la UI (fuentes, paneles). cssW = ancho "de teléfono"; f(px)
    // sale escalado al lienzo de diseño (1080).
    const cssW = this.W / this.dpr;
    this.uiScale = Phaser.Math.Clamp(cssW / 1280, 0.75, 1.15) * this.dpr;

    // Tamaño de carta: cómodo según la pantalla. Ya NO hace falta que entren las
    // 7 a lo ancho (la mano tiene scroll), así que en retrato son más grandes.
    this.handGap = Math.max(8 * this.dpr, this.W * 0.012);
    const heightFrac = this.isPortrait ? 0.25 : 0.26; // alto máx. relativo a la pantalla
    const widthShareFrac = this.isPortrait ? 0.5 : 0.28; // ancho máx. de una carta
    const capW = (this.isPortrait ? 170 : 150) * this.dpr; // en retrato las dejamos más grandes
    const byHeight = (this.H * heightFrac) / CARD_RATIO;
    const byWidthShare = this.W * widthShareFrac;
    this.cardW = Math.max(46 * this.dpr, Math.min(byHeight, byWidthShare, capW));
    this.cardH = this.cardW * CARD_RATIO;

    // La carta verde es un poco más grande.
    this.greenW = this.cardW * 1.08;
    this.greenH = this.greenW * CARD_RATIO;
    this.greenFont = Math.max(13 * this.dpr, Math.round(this.greenW * 0.16)); // solo para el placeholder 🟢?

    // En retrato el marcador es una tira de chips bajo la cabecera (reserva alto);
    // en horizontal va en un panel a la derecha (no ocupa alto del centro).
    const nPlayers = (this.players && this.players.length) || 4;
    if (this.isPortrait) {
      const perRow = Math.max(1, Math.floor(this.W / this.f(115)));
      const rows = Math.ceil(nPlayers / perRow);
      this.scoreH = rows * this.f(30) + this.f(6);
    } else {
      this.scoreH = 0;
    }

    // Anclas verticales (topes en px CSS → × dpr para el mundo en px de dispositivo).
    this.yHeader = Math.max(44 * this.dpr, Math.min(56 * this.dpr, this.H * 0.085));
    this.yGreen = this.yHeader + this.scoreH + this.greenH / 2 + 12 * this.dpr;
    // Holgura amplia bajo la carta verde: el banner puede ser de 2 líneas (crece hacia
    // arriba desde su centro) y no debe montarse sobre la carta verde.
    this.yStatus = this.yGreen + this.greenH / 2 + this.f(48);
    // La mano (abanico) se extiende ~0.80·h por debajo de su centro (extremos del arco
    // ~0.2·h + media carta + margen de rotación ±12°). Reserva justa + margen mínimo
    // abajo → la mano baja un pelín (menos choque con la pila) sin cortarse.
    this.yHand = this.H - this.cardH * 0.8 - this.f(2);
    this.yButton = this.H - this.f(40);
    // Fila central (jugadas) entre el estado y el borde superior de la mano.
    this.yCenter = (this.yStatus + this.f(20) + (this.yHand - this.cardH / 2)) / 2;
  }

  // Helper: escala un tamaño de fuente/medida por uiScale.
  f(px) {
    return Math.round(px * this.uiScale);
  }

  // ---------- Texturas de cartas POR CAPAS (cara/reverso) ----------
  // Placeholder de color base (rect redondeado) mientras carga la textura real.
  ensurePlaceholderTexture(color) {
    const key = `mcm:ph:${color}`;
    if (this.textures.exists(key)) return key;
    const w = 162, h = 248, r = 12;
    const t = this.textures.createCanvas(key, w, h);
    if (!t) return key;
    const ctx = t.getContext();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color === "verde" ? "#1A4629" : "#F39200";
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.fill();
    t.refresh();
    return key;
  }

  cardTextureKey(color, texto) {
    return `mcm:${color}:${texto}`;
  }
  reversoTextureKey(color) {
    return `mcm:rev:${color}`;
  }

  // Construye (una vez) la textura de la CARA por capas; resuelve con la llave o null.
  requestCardTexture(color, texto) {
    const key = this.cardTextureKey(color, texto);
    if (this.textures.exists(key)) return Promise.resolve(key);
    if (!this._texPromises[key]) {
      this._texPromises[key] = cardFaceCanvas({ color, texto, flavor: flavorFor(color, texto), pxW: TEX_PX })
        .then((canvas) => {
          if (!this.textures.exists(key)) this.textures.addCanvas(key, canvas);
          return key;
        })
        .catch((e) => {
          console.warn("cardTexture", color, texto, e);
          return null;
        });
    }
    return this._texPromises[key];
  }

  // Construye (una vez) la textura del REVERSO por color; resuelve con la llave o null.
  requestReversoTexture(color) {
    const key = this.reversoTextureKey(color);
    if (this.textures.exists(key)) return Promise.resolve(key);
    if (!this._texPromises[key]) {
      this._texPromises[key] = reversoCanvas({ color, pxW: TEX_PX })
        .then((canvas) => {
          if (!this.textures.exists(key)) this.textures.addCanvas(key, canvas);
          return key;
        })
        .catch((e) => {
          console.warn("reversoTexture", color, e);
          return null;
        });
    }
    return this._texPromises[key];
  }

  // Aplica la cara por capas a una imagen: síncrono si ya está en caché; si no,
  // muestra el placeholder y la intercambia cuando termina (guardando por destrucción).
  applyCardTexture(img, color, texto, w, h) {
    const key = this.cardTextureKey(color, texto);
    if (this.textures.exists(key)) {
      img.setTexture(key).setDisplaySize(w, h);
      return;
    }
    this.requestCardTexture(color, texto).then((k) => {
      if (k && img.scene) img.setTexture(k).setDisplaySize(w, h);
    });
  }

  applyReversoTexture(img, color, w, h) {
    const key = this.reversoTextureKey(color);
    if (this.textures.exists(key)) {
      img.setTexture(key).setDisplaySize(w, h);
      return;
    }
    this.requestReversoTexture(color).then((k) => {
      if (k && img.scene) img.setTexture(k).setDisplaySize(w, h);
    });
  }

  // Fondo estático tipo mesa de fieltro + cabecera (se redibuja al cambiar tamaño).
  drawStatic() {
    this.staticLayer.removeAll(true);

    const bg = this.add.graphics();
    bg.fillGradientStyle(
      COLORS.feltTop,
      COLORS.feltTop,
      COLORS.feltBottom,
      COLORS.feltBottom,
      1
    );
    bg.fillRect(0, 0, this.W, this.H);
    bg.fillStyle(0x000000, 0.18);
    bg.fillRect(0, 0, this.W, 6);
    bg.fillRect(0, this.H - 6, this.W, 6);
    this.staticLayer.add(bg);

    const header = this.add.graphics();
    header.fillStyle(0x000000, 0.25);
    header.fillRect(0, 0, this.W, this.yHeader);
    this.staticLayer.add(header);

    // Título completo solo en horizontal; en retrato la cabecera es angosta y se
    // dejaría el espacio para "Ronda/Meta" (el logo ya está en el menú).
    if (!this.isPortrait) {
      const title = this.add
        .text(this.W / 2, this.yHeader / 2, "🍈 Mamones con Mamones", {
          fontFamily: FONT_DISPLAY,
          fontSize: `${this.f(30)}px`,
          color: "#ffffff",
        })
        .setOrigin(0.5);
      this.staticLayer.add(title);
    }
  }

  // ---------------------------------------------------------------------------
  // Preparación
  // ---------------------------------------------------------------------------

  setupGame() {
    // Config de partida elegida en el menú (modo, piensaRapido, jugadores).
    const cfg = this.registry.get("gameConfig") || {};
    this.mode = cfg.mode || "clasica"; // "clasica" | "amarga"
    // Límites de tiempo por fase (personalizables a futuro desde la config de partida).
    this.playSecs = cfg.playSecs || 45; // seleccionar carta (jugadores)
    this.judgeSecs = cfg.judgeSecs || 60; // el Juez elige/descarta
    // Total de jugadores: tú + bots. Mínimo 4, máximo 6 (como el online, acotado
    // por el espacio en pantalla para las jugadas).
    const total = Phaser.Math.Clamp(cfg.players || 4, 4, 6);
    // Piensa Rápido solo tiene sentido con más de 5 jugadores (regla del online).
    this.piensaRapido = !!cfg.piensaRapido && total > 5;

    // Fuente de cartas: cartas.json (vía registry), con cards.js como respaldo.
    const data = this.registry.get("cartas");
    const verdes = (data && data.verdes) || GameData.greenCards;
    const rojas = (data && data.rojas) || GameData.redCards;
    // Deduplicar por si hay nombres repetidos en la lista.
    this.greenSource = [...new Set(verdes)];
    this.redSource = [...new Set(rojas)];

    // Jugadores: tú + (total-1) bots.
    this.players = [{ name: "Tú", isBot: false, hand: [], score: 0, greens: [] }];
    for (let i = 1; i < total; i++) {
      this.players.push({ name: `Bot ${i}`, isBot: true, hand: [], score: 0, greens: [] });
    }

    // Descarte vacío y mazos frescos al empezar la partida.
    this.redDiscard = new Set();
    this.refillGreenDeck();
    this.refillRedDeck();

    // Reparto inicial (sin repetir: drawRed excluye manos y descarte).
    this.players.forEach((p) => {
      while (p.hand.length < HAND_SIZE) p.hand.push(this.drawRed());
    });

    // Historial de la partida para el recap final (una entrada por ronda ganada).
    this.history = [];

    // El primer Juez es un bot, así el humano juega de una en la ronda 1.
    this.judgeIndex = 1;
    this.round = 1;

    // Un objeto de efectos (booleanos) por jugador.
    this.playerEffects = this.players.map(() => this.emptyEffects());
  }

  emptyEffects() {
    return {
      pelaElOjo: false,
      manoCongelada: false,
      mazoBarajado: false,
      jugarACiegas: false,
      pasaMamon: false,
      jugadaDoble: false,
    };
  }

  refillGreenDeck() {
    this.greenDeck = Phaser.Utils.Array.Shuffle([...this.greenSource]);
  }

  // Cartas rojas que ya están en la mano de algún jugador (para no repartirlas).
  redEnManos() {
    const s = new Set();
    this.players.forEach((p) => p.hand.forEach((c) => s.add(c)));
    return s;
  }

  // Reconstruye el mazo rojo con las cartas que NO están en manos ni descartadas.
  // Si no queda ninguna, recicla el descarte (como el online al agotarse el mazo).
  refillRedDeck() {
    const enManos = this.redEnManos();
    let pool = this.redSource.filter((c) => !enManos.has(c) && !this.redDiscard.has(c));
    if (pool.length === 0) {
      this.redDiscard.clear();
      pool = this.redSource.filter((c) => !enManos.has(c));
    }
    this.redDeck = Phaser.Utils.Array.Shuffle(pool);
  }

  drawGreen() {
    if (this.greenDeck.length === 0) this.refillGreenDeck();
    return this.greenDeck.pop();
  }

  drawRed() {
    if (this.redDeck.length === 0) this.refillRedDeck();
    return this.redDeck.pop();
  }

  // ---------------------------------------------------------------------------
  // Ciclo de la ronda
  // ---------------------------------------------------------------------------

  startRound() {
    // Cerrar cualquier modal/arrastre de la ronda anterior.
    this.closeConfirm();
    this._cardPress = null;
    this._cardDrag = null;
    this.discardedIdx = new Set();
    this._lastDiscarded = null;
    this._animateHandEntry = true; // repartir la mano con animación esta ronda

    // Recalcular el layout ya con los jugadores creados (afecta el alto del
    // marcador en retrato y, por ende, la posición de la carta verde).
    this.computeLayout();

    this.currentGreen = this.drawGreen();
    this.submissions = [];
    this.phase = "play";
    this.lastResult = null;
    this.worstResult = null;
    this.judgingStep = null;
    this.bestPick = null;

    // Reiniciar flags de efectos de la ronda y limpiar timers previos.
    this.clearFreezeTimers();
    this.handFrozen = false;
    this.greenRevealed = true;
    this.humanPlaysNeeded = 1;
    this.piensaRapidoVictim = null;
    this.fx = { pelaElOjo: false, manoCongelada: false, jugarACiegas: false, jugadaDoble: false };

    // Cerrar cualquier overlay de ruleta colgante (seguridad).
    this.closeRoulette(false);
    // Vaciar el montoncito del centro (nueva ronda).
    this.clearPile();

    // Cuántas cartas debe jugar cada jugador esta ronda (Jugada Doble => 2).
    this.playsNeeded = this.players.map(() => 0);

    // Aplicar al humano los efectos de la Ruleta (solo si juega esta ronda).
    if (this.judgeIndex !== 0) {
      this.applyHumanEffects();
      this.playsNeeded[0] = this.humanPlaysNeeded;
    }

    // Bots no-Juez: aplican sus efectos y juegan sus cartas con retraso.
    this.players.forEach((p, i) => {
      if (!p.isBot || i === this.judgeIndex) return;
      const { needed, delay } = this.applyBotEffects(i);
      this.playsNeeded[i] = needed;
      for (let n = 0; n < needed; n++) {
        this.time.delayedCall(delay + 700 + i * 250 + n * 450, () => this.botPlayCard(i));
      }
    });

    // Marca de inicio de la fase de jugadas (ventana de 5s de Piensa Rápido).
    this.roundStartMs = this.time.now;

    // Si el humano es el Juez, no juega carta: solo espera las jugadas de los bots.
    this.render();

    // Temporizador de selección (solo si el humano debe jugar; el Juez no juega).
    if (this.judgeIndex !== 0) this.startTimer(this.playSecs, () => this.autoPlayHuman());
    else this.stopTimer();
  }

  // Aplica al bot sus efectos de la Ruleta (los que tienen sentido para una IA)
  // y los consume. Devuelve cuántas cartas juega y cuánto retraso extra tiene.
  applyBotEffects(i) {
    const e = this.playerEffects[i];
    let needed = 1;
    let delay = 0;
    if (e) {
      if (e.jugadaDoble) needed = 2; // 🃏 juega dos cartas
      if (e.manoCongelada) delay = 3000; // 🥶 el bot "congelado" tarda más
      // 🌪️ mazoBarajado ya se aplicó al instante; 👀/⏳ no afectan a una IA.
      this.playerEffects[i] = this.emptyEffects();
    }
    return { needed, delay };
  }

  // Aplica al humano (índice 0) los efectos de la Ruleta y los consume.
  applyHumanEffects() {
    const e = this.playerEffects[0];
    if (!e) return;

    if (e.pelaElOjo) this.fx.pelaElOjo = true;
    if (e.jugarACiegas) {
      this.fx.jugarACiegas = true;
      this.greenRevealed = false;
    }
    if (e.jugadaDoble) {
      this.fx.jugadaDoble = true;
      this.humanPlaysNeeded = 2;
    }
    if (e.manoCongelada) {
      this.fx.manoCongelada = true;
      this.handFrozen = true;
      this.freezeSeconds = 10;
      this.freezeTick = this.time.addEvent({
        delay: 1000,
        repeat: 9,
        callback: () => {
          this.freezeSeconds -= 1;
          if (this.phase === "play") this.render();
        },
      });
      this.freezeTimer = this.time.delayedCall(10000, () => {
        this.handFrozen = false;
        if (this.phase === "play") this.render();
      });
    }

    // Consumir: los efectos eran para este turno.
    this.playerEffects[0] = this.emptyEffects();
  }

  clearFreezeTimers() {
    if (this.freezeTick) {
      this.freezeTick.remove(false);
      this.freezeTick = null;
    }
    if (this.freezeTimer) {
      this.freezeTimer.remove(false);
      this.freezeTimer = null;
    }
  }

  // Descarta la mano del jugador (no vuelve a repartirse) y le da 7 cartas nuevas.
  redealHand(playerIndex) {
    const p = this.players[playerIndex];
    while (p.hand.length) this.redDiscard.add(p.hand.pop());
    while (p.hand.length < HAND_SIZE) p.hand.push(this.drawRed());
  }

  // IA jugando: el bot elige una carta de su mano (al azar) y la juega.
  botPlayCard(playerIndex) {
    if (this.phase !== "play") return;
    const bot = this.players[playerIndex];
    if (bot.hand.length === 0) return;

    const idx = Phaser.Math.Between(0, bot.hand.length - 1);
    const card = bot.hand.splice(idx, 1)[0];
    this.throwOpponentCard(playerIndex); // boca abajo, lanzada desde su silla
    this.submitCard(playerIndex, card);
  }

  humanSubmittedCount() {
    return this.submissions.filter((s) => s.playerIndex === 0).length;
  }

  // El humano juega una carta de su mano.
  humanPlayCard(handIndex) {
    if (this.phase !== "play") return;
    if (this.judgeIndex === 0) return; // El humano es Juez: no juega.
    if (this.handFrozen) return; // 🥶 Mano congelada.
    if (this._animatingPlay) return; // ya hay una carta volando al centro
    if (this.humanSubmittedCount() >= this.humanPlaysNeeded) return; // ya cumplió su cupo

    // ⏳ A ciegas: al confirmar la primera carta se revela el adjetivo verde.
    if (this.fx.jugarACiegas && !this.greenRevealed) this.greenRevealed = true;

    // Posición mundial de la carta tocada, para volarla desde ahí al centro.
    const orig = this.handContainer && this.handContainer.list[handIndex];
    const fromX = orig ? this.handContainer.x + orig.x : this.W / 2;
    const fromY = orig ? this.handContainer.y + orig.y : this.yHand;

    // Ocultar la carta original y sacarla de la mano (datos) de una vez, para que
    // un re-render durante el vuelo no la muestre de nuevo.
    if (orig) orig.setVisible(false);
    const card = this.players[0].hand.splice(handIndex, 1)[0];

    this._animatingPlay = true;
    const flyer = this.makeRedCard(card);
    flyer.setPosition(fromX, fromY);
    this.animLayer.add(flyer);
    this.animateToPile(flyer, fromX, fromY, () => {
      this._animatingPlay = false;
      this.submitCard(0, card);
    });
  }

  // Posición (relativa al centro) del hueco 'slot' del montoncito: leve desorden.
  pileSlot(slot) {
    return {
      ox: this.f(((slot * 37) % 15) - 7),
      oy: this.f(((slot * 23) % 11) - 5),
      rot: ((slot * 29) % 21) - 10,
    };
  }

  // Vuela 'gameObj' en ARCO desde (fromX, fromY) al montoncito del centro y lo
  // deja ahí (visible). onDone se llama al aterrizar.
  animateToPile(gameObj, fromX, fromY, onDone) {
    const slot = this._pileCount++;
    const { ox, oy, rot } = this.pileSlot(slot);
    const toX = this.W / 2 + ox;
    const toY = this.yCenter + oy;
    const start = new Phaser.Math.Vector2(fromX, fromY);
    const end = new Phaser.Math.Vector2(toX, toY);
    // Punto de control por encima para que el vuelo trace una curva.
    const mid = new Phaser.Math.Vector2((fromX + toX) / 2, Math.min(fromY, toY) - this.f(90));
    const curve = new Phaser.Curves.QuadraticBezier(start, mid, end);
    const prox = { v: 0 };
    this.tweens.add({
      targets: prox,
      v: 1,
      duration: 480,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        const p = curve.getPoint(prox.v);
        gameObj.setPosition(p.x, p.y);
      },
      onComplete: () => {
        gameObj.setPosition(toX, toY);
        this._pile.push(gameObj); // se queda en el montoncito
        onDone && onDone();
      },
    });
    this.tweens.add({
      targets: gameObj,
      scale: 0.7,
      angle: rot,
      duration: 480,
      ease: "Sine.easeInOut",
    });
  }

  // Ángulo de la "silla" del rival k (de m rivales), repartidos parejo por el
  // semicírculo superior: 0°=derecha … 180°=izquierda. m=1 → 90° (arriba).
  seatAngle(k, m) {
    if (m <= 1) return 90;
    return (180 * k) / (m - 1);
  }

  // Carta boca abajo de un rival: LLEGA LANZADA desde su silla hacia el montoncito.
  throwOpponentCard(playerIndex) {
    const m = this.players.length - 1; // nº de rivales
    const k = Math.max(0, playerIndex - 1); // índice del rival (tú = 0)
    const deg = this.seatAngle(k, m);
    const th = Phaser.Math.DegToRad(deg);

    const cx = this.W / 2;
    const cyC = this.yCenter;
    // Punto de partida fuera, en la dirección de la silla (elipse alrededor del centro).
    const Rx = this.W * 0.6;
    const Ry = this.H * 0.42;
    const fromX = cx + Rx * Math.cos(th);
    const fromY = cyC - Ry * Math.sin(th);

    const slot = this._pileCount++;
    const { ox, oy } = this.pileSlot(slot);
    const toX = cx + ox;
    const toY = cyC + oy;
    // Rotación de aterrizaje: insinúa la dirección del lanzamiento + leve azar.
    const landAngle = (deg - 90) * 0.5 + Phaser.Math.Between(-6, 6);

    const back = this.makeCardBack(this.cardW, this.cardH, "roja");
    back.setPosition(fromX, fromY);
    back.setScale(0.5);
    back.setAngle((deg - 90) * 0.5);
    this.animLayer.add(back);
    this._pile.push(back);
    this.tweens.add({
      targets: back,
      x: toX,
      y: toY,
      angle: landAngle,
      scale: 0.7,
      duration: 340,
      ease: "Back.easeOut",
    });
  }

  // Limpia el montoncito del centro (al empezar la ronda o al pasar a juzgar).
  clearPile() {
    (this._pile || []).forEach((o) => this.tweens.killTweensOf(o));
    if (this.animLayer) this.animLayer.removeAll(true);
    this._pile = [];
    this._pileCount = 0;
  }

  submitCard(playerIndex, card) {
    this.submissions.push({ playerIndex, card, at: this.time.now });

    // El humano ya cumplió su cupo → cortar su temporizador de selección.
    if (playerIndex === 0 && this.humanSubmittedCount() >= this.humanPlaysNeeded) this.stopTimer();

    // ¿Ya jugaron todos? (con Jugada Doble alguien debe 2 cartas)
    const expected = this.playsNeeded.reduce((a, b) => a + b, 0);

    if (this.submissions.length >= expected) {
      this.beginJudging();
    } else {
      this.render();
    }
  }

  hasSubmitted(playerIndex) {
    return this.submissions.some((s) => s.playerIndex === playerIndex);
  }

  // Piensa Rápido: castiga al último en jugar si la ronda tardó ≥5s. Le devuelve
  // su carta a la mano y la saca de las jugadas. Requiere ≥2 jugadores distintos.
  aplicarPiensaRapido() {
    this.piensaRapidoVictim = null;
    if (!this.piensaRapido || this.submissions.length < 2) return;
    const distintos = new Set(this.submissions.map((s) => s.playerIndex)).size;
    if (distintos < 2) return;
    const ultimaMs = Math.max(...this.submissions.map((s) => s.at || 0));
    if (ultimaMs - this.roundStartMs < 5000) return; // todos rápidos: nadie pierde

    let li = 0;
    for (let i = 1; i < this.submissions.length; i++) {
      if ((this.submissions[i].at || 0) > (this.submissions[li].at || 0)) li = i;
    }
    const late = this.submissions.splice(li, 1)[0];
    this.players[late.playerIndex].hand.push(late.card); // la carta vuelve a su mano
    this.piensaRapidoVictim = late.playerIndex;
  }

  beginJudging() {
    // Piensa Rápido: si se tardaron, el último en jugar pierde su carta (vuelve a
    // su mano). Excepción: si todos jugaron en <5s, no se castiga a nadie.
    this.aplicarPiensaRapido();

    this.clearPile(); // el montoncito se reparte para juzgar

    this.phase = "judging";
    // Se mezclan las jugadas para que el Juez las vea de forma anónima.
    Phaser.Utils.Array.Shuffle(this.submissions);
    // En Amarga el Juez elige primero la MEJOR y luego la PEOR.
    this.judgingStep = this.mode === "amarga" ? "best" : null;
    this.bestPick = null;
    // Clásica: mecánica de descarte (el juez elimina perdedoras hasta la ganadora).
    this.discardedIdx = new Set();
    this._lastDiscarded = null;
    this._cardPress = null;
    this._cardDrag = null;

    const botJudge = this.players[this.judgeIndex].isBot;
    if (this.mode === "amarga") {
      if (botJudge) this.scheduleBotBest();
    } else if (botJudge) {
      this.scheduleBotDiscard(); // auto-descarte animado
    }
    this.render();

    // Temporizador del Juez solo si juzga el humano (los bots resuelven solos).
    if (!botJudge) this.startTimer(this.judgeSecs, () => this.resolveJudgeTimeout());
    else this.stopTimer();
  }

  scheduleBotBest() {
    this.time.delayedCall(1100, () => {
      if (this.phase !== "judging") return;
      this.judgePick(Phaser.Math.Between(0, this.submissions.length - 1));
    });
  }

  // Índices de submissions aún NO descartados.
  remainingSubmissions() {
    return this.submissions.map((_, i) => i).filter((i) => !this.discardedIdx.has(i));
  }

  // Descartar una jugada como perdedora (Clásica). Si queda una, gana sola.
  discardSubmission(i) {
    if (this.phase !== "judging" || this.mode === "amarga") return;
    if (this.discardedIdx.has(i)) return;
    this.discardedIdx.add(i);
    this._lastDiscarded = i; // para animar su caída al 🗑️ en el render
    const rem = this.remainingSubmissions();
    if (rem.length <= 1) {
      const win = rem[0];
      this.render();
      this.time.delayedCall(300, () => {
        if (this.phase !== "judging") return;
        this.awardBest(win);
        this.finishJudging();
      });
    } else {
      this.render();
    }
  }

  // Elegir ganadora directa: el resto salta al 🗑️ en cascada y esa gana.
  chooseWinner(i) {
    if (this.phase !== "judging" || this.mode === "amarga") return;
    this.submissions.forEach((_, k) => { if (k !== i) this.discardedIdx.add(k); });
    this._lastDiscarded = null; // cascada: se animan todas las nuevas del 🗑️
    this.render();
    this.time.delayedCall(460, () => {
      if (this.phase !== "judging") return;
      this.awardBest(i);
      this.finishJudging();
    });
  }

  // Juez BOT (Clásica): descarta perdedoras 1 a 1; la última deja una → gana sola.
  scheduleBotDiscard() {
    const idxs = this.submissions.map((_, i) => i);
    const winner = Phaser.Math.Between(0, idxs.length - 1);
    const losers = idxs.filter((k) => k !== winner);
    Phaser.Utils.Array.Shuffle(losers);
    let t = 800;
    for (const k of losers) {
      this.time.delayedCall(t, () => {
        if (this.phase !== "judging") return;
        this.discardSubmission(k);
      });
      t += 700;
    }
  }

  // Punto de entrada del Juez (humano o bot) al elegir una jugada.
  judgePick(submissionIndex) {
    if (this.phase !== "judging") return;

    // Clásica: una sola elección (la mejor).
    if (this.mode !== "amarga") {
      this.awardBest(submissionIndex);
      this.finishJudging();
      return;
    }

    // Amarga: paso "mejor" y luego paso "peor".
    if (this.judgingStep === "best") {
      this.bestPick = this.submissions[submissionIndex];
      this.awardBest(submissionIndex);
      this.judgingStep = "worst";

      if (this.players[this.judgeIndex].isBot) {
        this.time.delayedCall(900, () => {
          if (this.phase !== "judging" || this.judgingStep !== "worst") return;
          this.judgeWorst(this.worstSelectableIndices()[0]);
        });
      }
      this.render();
    } else if (this.judgingStep === "worst") {
      if (this.submissions[submissionIndex] === this.bestPick) return; // no re-elegir la mejor
      this.judgeWorst(submissionIndex);
    }
  }

  awardBest(submissionIndex) {
    const best = this.submissions[submissionIndex];
    this.players[best.playerIndex].score += 1;
    this.players[best.playerIndex].greens.push(this.currentGreen); // verde ganada (apartado/meta)
    this.lastResult = { winnerIndex: best.playerIndex, card: best.card };
    // Registrar la ronda para el recap (verde jugada → roja ganadora → quién).
    this.history.push({
      ronda: this.round,
      verde: this.currentGreen,
      roja: best.card,
      ganador: this.players[best.playerIndex].name,
    });
  }

  worstSelectableIndices() {
    return this.submissions
      .map((_, i) => i)
      .filter((i) => this.submissions[i] !== this.bestPick);
  }

  judgeWorst(submissionIndex) {
    const worst = this.submissions[submissionIndex];
    if (!worst) { this.finishJudging(); return; } // sin peor válida: sigue sin ruleta
    this.worstResult = { loserIndex: worst.playerIndex, card: worst.card };
    this.finishJudging();
    // El jugador de la peor carta gira la Ruleta del Mamón Amargo.
    if (this.phase === "result") this.activarRuletaMamonAmargo(worst.playerIndex);
  }

  finishJudging() {
    this.stopTimer(); // el Juez ya resolvió
    const winner = this.players[this.lastResult.winnerIndex];
    this.phase = winner.score >= metaGanar(this.players.length) ? "gameover" : "result";
    this.render();
    // Al terminar, avisar a React para que muestre el recap (overlay en el DOM).
    if (this.phase === "gameover") {
      this.game.events.emit("mcm:gameover", {
        campeon: winner.name,
        standings: this.players
          .map((p) => ({ nombre: p.name, rondas: p.score, yo: !p.isBot }))
          .sort((a, b) => b.rondas - a.rondas),
        rondas: this.history,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Temporizador de ronda (45s jugar · 60s juzgar; personalizable a futuro)
  // ---------------------------------------------------------------------------
  startTimer(seconds, onExpire) {
    this.stopTimer();
    this.timerDeadline = this.time.now + seconds * 1000;
    this._onTimerExpire = onExpire;
    this.renderTimer(seconds);
    this.timerEvent = this.time.addEvent({
      delay: 200,
      loop: true,
      callback: () => {
        const remMs = this.timerDeadline - this.time.now;
        this.renderTimer(Math.max(0, Math.ceil(remMs / 1000)));
        if (remMs <= 0) {
          const cb = this._onTimerExpire;
          this.stopTimer();
          if (cb) cb();
        }
      },
    });
  }

  stopTimer() {
    if (this.timerEvent) {
      this.timerEvent.remove();
      this.timerEvent = null;
    }
    this._onTimerExpire = null;
    if (this.hud) this.hud.removeAll(true);
  }

  // Píldora de cuenta regresiva arriba a la derecha (en rojo cuando queda poco).
  renderTimer(secs) {
    if (!this.hud) return;
    this.hud.removeAll(true);
    const urgent = secs <= 10;
    const color = urgent ? "#ff5a4d" : COLORS.goldHex;
    const txt = this.add
      .text(0, 0, `⏱ ${secs}`, {
        fontFamily: FONT_DISPLAY,
        fontSize: `${this.f(22)}px`,
        color,
        letterSpacing: 0.5,
      })
      .setOrigin(1, 0.5);
    const padX = this.f(12);
    const padY = this.f(6);
    const w = txt.width + padX * 2;
    const h = txt.height + padY * 2;
    const rx = this.W - this.f(14); // ancla derecha
    const cyp = this.yHeader / 2;
    const g = this.add.graphics();
    g.fillStyle(COLORS.panel, 0.9);
    g.fillRoundedRect(rx - w, cyp - h / 2, w, h, h / 2);
    g.lineStyle(2, urgent ? 0xff5a4d : COLORS.panelBorder, 0.9);
    g.strokeRoundedRect(rx - w, cyp - h / 2, w, h, h / 2);
    txt.setPosition(rx - padX, cyp);
    this.hud.add(g);
    this.hud.add(txt);
  }

  // Se agotó el tiempo de jugar: juega carta(s) al azar por el humano (elección del usuario).
  autoPlayHuman() {
    if (this.phase !== "play") return;
    this.closeConfirm();
    const playOne = () => {
      if (this.phase !== "play") return;
      if (this.humanSubmittedCount() >= this.humanPlaysNeeded) return;
      const hand = this.players[0].hand;
      if (!hand.length) return;
      this.humanPlayCard(Phaser.Math.Between(0, hand.length - 1));
      // Jugada Doble: encadenar la siguiente tras la animación (submitCard ~480ms).
      if (this.humanSubmittedCount() + 1 < this.humanPlaysNeeded) {
        this.time.delayedCall(650, playOne);
      }
    };
    playOne();
  }

  // Se agotó el tiempo del Juez (humano): elige ganadora al azar (elección del usuario).
  resolveJudgeTimeout() {
    if (this.phase !== "judging" || this.judgeIndex !== 0) return;
    this.closeConfirm();
    const rem = this.remainingSubmissions();
    if (!rem.length) return;
    const pick = rem[Phaser.Math.Between(0, rem.length - 1)];
    if (this.mode !== "amarga") {
      this.chooseWinner(pick);
      return;
    }
    // Amarga: mejor al azar y luego peor al azar.
    if (this.judgingStep === "best") {
      this.judgePick(pick);
      this.time.delayedCall(1000, () => {
        if (this.phase !== "judging" || this.judgingStep !== "worst") return;
        const w = this.worstSelectableIndices();
        if (w.length) this.judgeWorst(w[Phaser.Math.Between(0, w.length - 1)]);
      });
    } else if (this.judgingStep === "worst") {
      const w = this.worstSelectableIndices();
      if (w.length) this.judgeWorst(w[Phaser.Math.Between(0, w.length - 1)]);
    }
  }

  // ---------------------------------------------------------------------------
  // La Ruleta del Mamón Amargo
  // ---------------------------------------------------------------------------

  // Elige al azar uno de los 6 efectos, lo activa para el jugador y lo anuncia.
  activarRuletaMamonAmargo(playerIndex, depth = 0) {
    // Efectos que entran al sorteo. "Mano congelada" (2) solo con Piensa Rápido.
    const efectos = this.piensaRapido ? [1, 2, 3, 4, 5, 6] : [1, 3, 4, 5, 6];
    const rand = () => efectos[Phaser.Math.Between(0, efectos.length - 1)];
    let pick = rand();
    // Corta cadenas infinitas de "pasa el mamón".
    while (pick === 5 && depth >= 3) pick = rand();

    const fx = RULETA_EFFECTS[pick];
    this.playerEffects[playerIndex][fx.key] = true;

    // Efecto inmediato: barajar la mano ya mismo.
    if (fx.key === "mazoBarajado") this.redealHand(playerIndex);

    this.pendingRoulette = {
      playerIndex,
      pick,
      fx,
      depth,
      efectos,
      transfer: fx.key === "pasaMamon",
    };
    this.showRoulette(); // anima la rueda y al detenerse revela el efecto
  }

  nextRound() {
    // Descartar las cartas jugadas: no vuelven a ninguna mano en esta partida.
    this.submissions.forEach((s) => this.redDiscard.add(s.card));
    // Reponer manos hasta HAND_SIZE (drawRed excluye manos y descarte).
    this.players.forEach((p) => {
      while (p.hand.length < HAND_SIZE) p.hand.push(this.drawRed());
    });
    // Rotar el Juez y avanzar la ronda.
    this.judgeIndex = (this.judgeIndex + 1) % this.players.length;
    this.round += 1;
    this.startRound();
  }

  restartGame() {
    this.stopTimer();
    this.setupGame();
    this.startRound();
  }

  // ---------------------------------------------------------------------------
  // Render (se redibuja la capa dinámica según la fase)
  // ---------------------------------------------------------------------------

  render() {
    // Limpiar el estado de scroll de la mano (la máscara no está en this.ui).
    if (this.handMaskShape) {
      this.handMaskShape.destroy();
      this.handMaskShape = null;
    }
    this.handContainer = null;
    this.handScroll = null;
    this.handBand = null;
    this.scrollThumb = null;
    this.scrollbar = null;
    this._dragging = false;
    this._handDragged = false;
    this._handVel = 0;
    this._lastPointerX = 0;

    this.ui.removeAll(true);

    this.drawRoundLabel();
    this.drawScoreboard();
    this.drawGreenCard();
    this.drawStatusBanner();

    if (this.phase === "play") {
      this.drawPlayerHand();
    } else if (this.phase === "judging") {
      this.drawSubmissions(false, "Jugadas");
    } else if (this.phase === "result") {
      this.drawSubmissions(true, "Resultado de la ronda");
      this.drawNextButton("Siguiente ronda", () => this.nextRound());
    } else if (this.phase === "gameover") {
      // El recap (campeón, podio y repaso) y el botón "Jugar de nuevo" los
      // dibuja React encima del canvas (ver PhaserGame). Aquí solo dejamos las
      // jugadas de la última ronda como fondo.
      this.drawSubmissions(true, "¡Fin de la partida!");
    }

    // La ruleta vive en su propio overlay animado (this.rouletteLayer), por
    // encima de this.ui, así que no se redibuja aquí.
  }

  drawRoundLabel() {
    const t = this.add
      .text(this.f(20), this.yHeader / 2, `Ronda ${this.round} · Meta ${metaGanar(this.players.length)}`, {
        fontFamily: FONT_DISPLAY,
        fontSize: `${this.f(20)}px`,
        color: COLORS.goldHex,
      })
      .setOrigin(0, 0.5);
    this.ui.add(t);
  }

  // ---------- Verdes ganadas: mini-carta + pila superpuesta (solo títulos) ----------
  // Mini carta VERDE (misma textura por capas que la grande, cacheada por texto).
  // `h` = alto en px; devuelve un contenedor h·ratio de ancho, con filo dorado.
  makeGreenMini(text, h) {
    const w = h / CARD_RATIO;
    const c = this.add.container(0, 0);
    const img = this.add
      .image(0, 0, this.ensurePlaceholderTexture("verde"))
      .setOrigin(0.5)
      .setDisplaySize(w, h);
    c.add(img);
    this.applyCardTexture(img, "verde", text, w, h);
    c.add(this.cardKeyline(w, h));
    c.cardW = w;
    c.cardH = h;
    return c;
  }

  // Pila de verdes superpuestas hacia la derecha: cada carta tapa a la anterior
  // dejando ver su borde IZQUIERDO (donde va el título). La última se ve entera.
  // Añade los contenedores a `parent`; devuelve el ancho total ocupado.
  // `revealFactor` = fracción del ancho visible por carta tapada (0.26 ≈ franja del título).
  drawGreenStack(parent, xLeft, cy, greens, miniH, revealFactor = 0.26) {
    const w = miniH / CARD_RATIO;
    const n = greens.length;
    if (!n) return 0;
    const stride = w * revealFactor;
    const totalW = w + (n - 1) * stride;
    greens.forEach((text, i) => {
      const mini = this.makeGreenMini(text, miniH);
      mini.setPosition(xLeft + w / 2 + i * stride, cy);
      parent.add(mini);
    });
    return totalW;
  }

  drawScoreboard() {
    if (this.isPortrait) return this.drawScoreStrip();

    const meta = metaGanar(this.players.length);
    const w = Math.min(this.f(230), this.W * 0.36);
    const miniH = this.f(26); // alto de las mini-verdes en la pila
    const rowH = this.f(28) + miniH + this.f(6);
    const padTop = this.f(40);
    const h = padTop + this.players.length * rowH + this.f(10);
    const x = this.W - w - this.f(16);
    const y = this.yHeader + 12;

    const g = this.add.graphics();
    g.fillStyle(COLORS.panel, 0.8);
    g.fillRoundedRect(x, y, w, h, 12);
    g.lineStyle(2, COLORS.panelBorder, 0.9);
    g.strokeRoundedRect(x, y, w, h, 12);
    this.ui.add(g);

    const title = this.add.text(x + this.f(14), y + this.f(13), `VERDES · META ${meta}`, {
      fontFamily: FONT_DISPLAY,
      fontSize: `${this.f(14)}px`,
      color: COLORS.textMuted,
      letterSpacing: 1,
    }).setOrigin(0, 0.5);
    this.ui.add(title);

    this.players.forEach((p, i) => {
      const isJudge = i === this.judgeIndex;
      const rowTop = y + padTop + i * rowH;
      const nameY = rowTop + this.f(12);

      const name = this.add
        .text(x + this.f(14), nameY, p.name, {
          fontFamily: FONT_UI,
          fontSize: `${this.f(15)}px`,
          color: isJudge ? COLORS.goldHex : COLORS.textLight,
          fontStyle: isJudge ? "bold" : "normal",
        })
        .setOrigin(0, 0.5);
      this.ui.add(name);

      if (isJudge) {
        const badge = this.add
          .text(x + this.f(14) + name.width + 8, nameY, "JUEZ", {
            fontFamily: FONT_DISPLAY,
            fontSize: `${this.f(12)}px`,
            color: COLORS.dark,
            backgroundColor: COLORS.goldHex,
            padding: { x: 5, y: 1 },
          })
          .setOrigin(0, 0.5);
        this.ui.add(badge);
      }

      const cnt = this.add
        .text(x + w - this.f(12), nameY, `${p.score}/${meta}`, {
          fontFamily: FONT_UI,
          fontSize: `${this.f(15)}px`,
          color: p.score >= meta ? COLORS.goldHex : COLORS.textLight,
          fontStyle: "bold",
        })
        .setOrigin(1, 0.5);
      this.ui.add(cnt);

      // Pila de verdes superpuestas (solo se ven los títulos); guion tenue si no hay.
      const stackY = rowTop + this.f(24) + miniH / 2;
      if (p.greens.length) {
        this.drawGreenStack(this.ui, x + this.f(14), stackY, p.greens, miniH);
      } else {
        const dash = this.add
          .text(x + this.f(14), stackY, "—", {
            fontFamily: FONT_UI,
            fontSize: `${this.f(13)}px`,
            color: COLORS.textMuted,
          })
          .setOrigin(0, 0.5);
        this.ui.add(dash);
      }
    });

    // Toda la tarjeta abre el overlay con las verdes en grande (encima de todo lo demás).
    const hit = this.add.graphics();
    hit.setInteractive(new Phaser.Geom.Rectangle(x, y, w, h), Phaser.Geom.Rectangle.Contains);
    hit.on("pointerup", () => this.openGreensOverlay());
    this.ui.add(hit);
  }

  // Overlay a pantalla completa: las verdes ganadas de CADA jugador, superpuestas y
  // legibles (títulos a la vista). Se cierra tocando fuera o "Cerrar".
  openGreensOverlay() {
    if (this.confirmLayer) return;
    const meta = metaGanar(this.players.length);
    const layer = this.add.container(0, 0);
    this.confirmLayer = layer;

    const dim = this.add.graphics();
    dim.fillStyle(0x000000, 0.82);
    dim.fillRect(0, 0, this.W, this.H);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, this.W, this.H), Phaser.Geom.Rectangle.Contains);
    dim.on("pointerup", () => this.closeConfirm());
    layer.add(dim);

    const title = this.add
      .text(this.W / 2, this.f(26), `Cartas verdes ganadas · Meta ${meta}`, {
        fontFamily: FONT_DISPLAY,
        fontSize: `${this.f(22)}px`,
        color: COLORS.goldHex,
        align: "center",
        letterSpacing: 0.5,
      })
      .setOrigin(0.5);
    layer.add(title);

    const top = this.f(54);
    const bottom = this.H - this.f(58);
    const n = this.players.length;
    const rowH = (bottom - top) / n;
    const nameColW = Math.min(this.f(140), this.W * 0.28);
    const stackLeft = this.f(18) + nameColW;
    const availW = this.W - stackLeft - this.f(18);
    const maxG = Math.max(1, ...this.players.map((p) => p.greens.length));
    const wByWidth = availW / (1 + (maxG - 1) * 0.3);
    const miniH = Math.min(this.f(98), rowH * 0.74, wByWidth * CARD_RATIO);

    this.players.forEach((p, i) => {
      const isJudge = i === this.judgeIndex;
      const cy = top + i * rowH + rowH / 2;

      const name = this.add
        .text(this.f(18), cy - this.f(9), p.name, {
          fontFamily: FONT_UI,
          fontSize: `${this.f(17)}px`,
          color: isJudge ? COLORS.goldHex : COLORS.textLight,
          fontStyle: "bold",
        })
        .setOrigin(0, 0.5);
      layer.add(name);

      const cnt = this.add
        .text(this.f(18), cy + this.f(13), `${p.score}/${meta}`, {
          fontFamily: FONT_UI,
          fontSize: `${this.f(13)}px`,
          color: p.score >= meta ? COLORS.goldHex : COLORS.textMuted,
          fontStyle: "bold",
        })
        .setOrigin(0, 0.5);
      layer.add(cnt);

      if (p.greens.length) {
        this.drawGreenStack(layer, stackLeft, cy, p.greens, miniH, 0.3);
      } else {
        const none = this.add
          .text(stackLeft, cy, "Sin verdes aún", {
            fontFamily: FONT_UI,
            fontSize: `${this.f(13)}px`,
            color: COLORS.textMuted,
            fontStyle: "italic",
          })
          .setOrigin(0, 0.5);
        layer.add(none);
      }

      if (i < n - 1) {
        const sep = this.add.graphics();
        sep.lineStyle(1, COLORS.panelBorder, 0.35);
        sep.lineBetween(this.f(16), top + (i + 1) * rowH, this.W - this.f(16), top + (i + 1) * rowH);
        layer.add(sep);
      }
    });

    this.drawMiniButton(this.W / 2, this.H - this.f(28), this.f(160), this.f(40), "Cerrar", () => this.closeConfirm(), true, layer);
  }

  // Marcador compacto para retrato: chips "nombre pts" centradas, con salto de
  // línea; la del Juez va en dorado. Ocupa this.scoreH bajo la cabecera.
  drawScoreStrip() {
    const margin = this.f(12);
    const maxW = this.W - margin * 2;
    const gap = this.f(6);
    const chipH = this.f(26);
    const padX = this.f(9);
    const yTop = this.yHeader + this.f(5);
    const meta = metaGanar(this.players.length);

    // Construir chips (texto) y medir su ancho.
    const chips = this.players.map((p, i) => {
      const isJudge = i === this.judgeIndex;
      const label = this.add
        .text(0, 0, `${isJudge ? "⚖️ " : ""}${p.name} ${p.score}/${meta}`, {
          fontFamily: FONT_UI,
          fontSize: `${this.f(13)}px`,
          color: isJudge ? COLORS.dark : COLORS.textLight,
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      return { label, w: label.width + padX * 2, isJudge };
    });

    // Repartir en filas que quepan en el ancho.
    const rows = [[]];
    let rowW = 0;
    for (const c of chips) {
      const extra = rows[rows.length - 1].length ? gap : 0;
      if (rowW + extra + c.w > maxW && rows[rows.length - 1].length) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push(c);
      rowW += (rows[rows.length - 1].length > 1 ? gap : 0) + c.w;
    }

    // Dibujar cada fila centrada.
    rows.forEach((row, ri) => {
      const totalW = row.reduce((s, c) => s + c.w, 0) + gap * (row.length - 1);
      let x = (this.W - totalW) / 2;
      const cy = yTop + ri * (chipH + gap) + chipH / 2;
      for (const c of row) {
        const g = this.add.graphics();
        g.fillStyle(c.isJudge ? COLORS.gold : COLORS.panel, c.isJudge ? 1 : 0.8);
        g.fillRoundedRect(x, cy - chipH / 2, c.w, chipH, chipH / 2);
        if (!c.isJudge) {
          g.lineStyle(1, COLORS.panelBorder, 0.9);
          g.strokeRoundedRect(x, cy - chipH / 2, c.w, chipH, chipH / 2);
        }
        this.ui.add(g);
        c.label.setPosition(x + c.w / 2, cy);
        this.ui.add(c.label);
        x += c.w + gap;
      }
    });

    // La tira completa abre el overlay con las verdes ganadas (superpuestas, legibles).
    const stripH = rows.length * (chipH + gap);
    const hit = this.add.graphics();
    hit.setInteractive(new Phaser.Geom.Rectangle(0, yTop, this.W, stripH), Phaser.Geom.Rectangle.Contains);
    hit.on("pointerup", () => this.openGreensOverlay());
    this.ui.add(hit);
  }

  drawGreenCard() {
    const w = this.greenW;
    const h = this.greenH;
    const container = this.add.container(this.W / 2, this.yGreen);

    container.add(this.cardShadow(w, h));

    // ⏳ A ciegas: el adjetivo verde está oculto hasta que el humano juega.
    if (!this.greenRevealed) {
      const g = this.add.graphics();
      g.fillStyle(0x143015, 1);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.1);
      g.lineStyle(2, COLORS.panelBorder, 1);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.1);
      container.add(g);
      const q = this.add
        .text(0, 0, "🟢\n?", {
          fontFamily: FONT_UI,
          fontSize: `${Math.round(this.greenFont * 1.5)}px`,
          color: COLORS.textMuted,
          align: "center",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      container.add(q);
      this.ui.add(container);
      return;
    }

    const img = this.add
      .image(0, 0, this.ensurePlaceholderTexture("verde"))
      .setOrigin(0.5)
      .setDisplaySize(w, h);
    container.add(img);
    // Cara VERDE por capas (píldora + título rotado + flavor); reemplaza el placeholder.
    this.applyCardTexture(img, "verde", this.currentGreen, w, h);
    container.add(this.cardKeyline(w, h)); // filo dorado: separa del fieltro

    this.ui.add(container);
  }

  drawStatusBanner() {
    let msg = "";
    const humanIsJudge = this.judgeIndex === 0;

    if (this.phase === "play") {
      if (humanIsJudge) {
        msg = "Eres el Juez. Espera a que los demás jueguen su carta...";
      } else if (this.handFrozen) {
        msg = `🥶 Mano congelada... ${this.freezeSeconds}s`;
      } else if (this.humanSubmittedCount() >= this.humanPlaysNeeded) {
        msg = "Ya jugaste. Esperando a los demás...";
      } else if (this.fx.jugadaDoble) {
        msg = `🃏 Jugada doble: elige ${this.humanPlaysNeeded - this.humanSubmittedCount()} carta(s).`;
      } else if (this.fx.jugarACiegas) {
        msg = "⏳ A ciegas: elige tu carta SIN ver el adjetivo verde.";
      } else if (this.fx.pelaElOjo) {
        msg = "👀 Boca abajo: mantén pulsado para espiar, doble clic para jugar.";
      } else {
        msg = "Elige una carta de tu mano para jugarla.";
      }
    } else if (this.phase === "judging") {
      if (humanIsJudge) {
        if (this.mode === "amarga") {
          msg =
            this.judgingStep === "best"
              ? "Eres el Juez: elige la MEJOR carta."
              : "Ahora elige la PEOR carta (el Mamón Amargo).";
        } else {
          msg = "Eres el Juez: descarta las perdedoras (arrástralas a la papelera) o toca una para elegir ganadora.";
        }
      } else {
        msg = `${this.players[this.judgeIndex].name} (Juez) está descartando...`;
      }
    } else if (this.phase === "result") {
      const w = this.players[this.lastResult.winnerIndex];
      msg = `Ganó la ronda: ${w.name} con "${this.lastResult.card}"`;
    } else if (this.phase === "gameover") {
      const w = this.players[this.lastResult.winnerIndex];
      msg = `¡${w.name} gana la partida con ${w.score} puntos!`;
    }

    this.drawPill(this.W / 2, this.yStatus, msg);

    // Nota de Piensa Rápido: el último en jugar perdió su carta esta ronda.
    if (this.piensaRapidoVictim != null && (this.phase === "judging" || this.phase === "result")) {
      const v = this.players[this.piensaRapidoVictim];
      const txt =
        this.piensaRapidoVictim === 0
          ? "🐢 Te pasaste de lento: tu carta se quedó en la mano."
          : `🐢 ${v.name} se tardó: su carta se quedó en la mano.`;
      const note = this.add
        .text(this.W / 2, this.yStatus + this.f(26), txt, {
          fontFamily: FONT_UI,
          fontSize: `${this.f(13)}px`,
          color: COLORS.textMuted,
          align: "center",
          wordWrap: { width: this.W * 0.9 },
        })
        .setOrigin(0.5);
      this.ui.add(note);
    }
  }

  // Píldora de texto centrada con fondo.
  drawPill(cx, cy, message) {
    const label = this.add
      .text(cx, cy, message, {
        fontFamily: FONT_UI,
        fontSize: `${this.f(17)}px`,
        color: COLORS.textLight,
        align: "center",
        wordWrap: { width: this.W * 0.9 },
      })
      .setOrigin(0.5);

    const padX = this.f(20);
    const padY = this.f(9);
    const w = label.width + padX * 2;
    const h = label.height + padY * 2;

    const g = this.add.graphics();
    g.fillStyle(COLORS.panel, 0.85);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, h / 2);
    g.lineStyle(2, COLORS.panelBorder, 0.7);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, h / 2);

    this.ui.add(g);
    this.ui.add(label); // el texto queda por encima del fondo
  }

  // Mano del jugador humano (abajo), en dos vistas: ABANICO (baraja en arco) o
  // COMPLETAS (1 fila si cabe / 2 filas en angosto). El contenedor va centrado en
  // (W/2, yHand) y cada carta se posiciona en coords locales. Sin scroll (ambas caben).
  drawPlayerHand() {
    const hand = this.players[0].hand;
    const canPlay =
      this.judgeIndex !== 0 &&
      !this.handFrozen &&
      this.humanSubmittedCount() < this.humanPlaysNeeded;
    const faceDown = this.fx.pelaElOjo;

    const n = hand.length;
    const w = this.cardW;
    const h = this.cardH;
    const gap = this.handGap;
    const cy = this.yHand;
    const margin = Math.max(this.f(16), this.W * 0.03);
    const viewportW = this.W - 2 * margin;

    // Posiciones locales {x,y,angle} + escala + extensión vertical. Única vista: abanico.
    const layout = this.fanLayout(n, w, h, viewportW);

    // Banda (para inHandBand/gestos) cubriendo el alto real del layout.
    const bandTop = cy + layout.top - this.f(6);
    const bandBottom = cy + layout.bottom + this.f(6);
    this.handBand = { top: bandTop, bottom: bandBottom };

    const animate = this._animateHandEntry;

    // Pre-rasterizar la mano ANTES de la barrida: si vamos a animar y falta alguna
    // textura, precárgalas todas y difiere el dibujo; al terminar re-renderiza (ya
    // cacheadas) y la barrida sale fluida en vez de ir rasterizando bajo demanda.
    if (animate) {
      if (this._handPrewarming) return; // en pleno precalentado: no dibujes la mano aún
      const sig = hand.join("|");
      const allCached = hand.every((t) => this.textures.exists(this.cardTextureKey("roja", t)));
      if (!allCached && this._handWarmSig !== sig) {
        this._handWarmSig = sig; // marca este reparto (evita reintentos en bucle si algo falla)
        this._handPrewarming = true;
        Promise.all(hand.map((t) => this.requestCardTexture("roja", t))).finally(() => {
          this._handPrewarming = false;
          if (this.scene && this.scene.isActive() && this.phase === "play") this.render();
        });
        return;
      }
    }
    this._animateHandEntry = false;

    const container = this.add.container(this.W / 2, cy);
    hand.forEach((text, i) => {
      const P = layout.pos[i];
      const card = this.makeRedCard(text);
      card.setPosition(P.x, P.y);
      card.setAngle(P.angle);
      if (layout.scale !== 1) card.setScale(layout.scale);
      card.baseScale = layout.scale;
      const finalAlpha = canPlay ? 1 : 0.65;
      card.setAlpha(finalAlpha);
      if (animate) this._animateCardIn(card, i, n, P, layout.scale, finalAlpha);

      // 👀 "Pela el ojo": un reverso cubre la carta y se levanta al espiar.
      let back = null;
      if (faceDown) {
        back = this.makeCardBack(w, h, "roja");
        card.add(back);
      }

      if (canPlay) {
        const img = card.cardImage;
        img.setInteractive({ useHandCursor: true });

        if (faceDown) {
          // Mantener pulsado = espiar; doble clic = jugar a ciegas.
          img.on("pointerdown", () => {
            if (back) back.setVisible(false);
            const now = this.time.now;
            if (this._lastTapIndex === i && now - this._lastTapTime < 350) {
              this._lastTapTime = 0;
              this._lastTapIndex = -1;
              if (!this._handDragged) this.humanPlayCard(i);
            } else {
              this._lastTapTime = now;
              this._lastTapIndex = i;
            }
          });
          img.on("pointerup", () => back && back.setVisible(true));
          img.on("pointerout", () => back && back.setVisible(true));
        } else {
          img.on("pointerover", () => {
            if (this._cardDrag || this.confirmLayer) return;
            card.setScale((card.baseScale || 1) * 1.06);
            container.bringToTop(card); // al frente para verla completa sobre las vecinas
          });
          img.on("pointerout", () => {
            if (this._cardDrag) return;
            card.setScale(card.baseScale || 1);
            // Restaurar el ORDEN original (índice i) para no dejar el solape encimado.
            if (card.parentContainer === container) container.moveTo(card, i);
          });
          // Press pendiente; la resolución (tap→modal, arrastre-arriba→jugar) ocurre
          // en los handlers de escena (pointermove/up).
          img.on("pointerdown", (p) => {
            if (this.confirmLayer || this._animatingPlay || this._cardDrag) return;
            this._cardPress = { i, text, x: p.x, y: p.y };
            this._handDragged = false;
          });
        }
      }
      container.add(card);
    });
    this.ui.add(container);
    this.handContainer = container;
    this.handScroll = null; // sin scroll horizontal
  }

  // Layout ABANICO: solape IZQUIERDA→DERECHA. Cada carta deja ver su franja izquierda
  // (donde va el título) y la última (derecha) va encima, completa = la más cercana al
  // jugador. Compacto (entra mejor en pantalla) y con todos los títulos legibles en orden.
  fanLayout(n, w, h, viewportW) {
    const reveal = 0.34; // fracción del ancho visible de cada carta tapada (la franja del título)
    // Escala para que TODO el abanico quepa en el ancho disponible (nunca se sale).
    const baseTotal = w + (n - 1) * (w * reveal);
    const scale = viewportW && baseTotal > viewportW ? viewportW / baseTotal : 1;
    const ws = w * scale, hs = h * scale;
    const stride = ws * reveal;
    const totalW = ws + (n - 1) * stride;
    const startX = -totalW / 2 + ws / 2;
    const pos = [];
    let maxY = 0;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) - 0.5 : 0; // -0.5 (izq) .. 0.5 (der)
      const angle = t * 24; // abanico bien curvo (±12°): las cartas rotan siguiendo el arco
      const y = t * t * hs * 0.8; // arco: centro arriba, extremos ~0.2·h más abajo
      pos.push({ x: startX + i * stride, y, angle });
      if (y > maxY) maxY = y;
    }
    this._handStartX = startX; // arranque de la animación de entrada (barrido desde la izq)
    const pad = hs * 0.1; // margen por la rotación (±12°)
    return { pos, scale, top: -hs / 2 - pad, bottom: maxY + hs / 2 + pad };
  }

  // Animación de entrada del abanico: "abre desde la izquierda" — todas parten
  // apiladas en la posición de la carta más a la izquierda (baraja cerrada) y barren
  // a su sitio hacia la derecha, escalonadas (la derecha lidera).
  _animateCardIn(card, i, n, P, finalScale, finalAlpha) {
    card.setPosition(this._handStartX ?? P.x, 0);
    card.setAngle(0);
    card.setScale(finalScale);
    card.setAlpha(0);
    this.tweens.add({
      targets: card,
      x: P.x, y: P.y, angle: P.angle, alpha: finalAlpha,
      delay: (n - 1 - i) * 55, duration: 430, ease: "Cubic.easeOut",
    });
  }

  // Barra de desplazamiento bajo la mano (indica posición; se actualiza al hacer scroll).
  drawScrollbar(tx, tw, ty, totalW) {
    const h = this.f(6);

    const track = this.add.graphics();
    track.fillStyle(0x000000, 0.3);
    track.fillRoundedRect(tx, ty, tw, h, h / 2);
    this.ui.add(track);

    const thumbW = Math.max(this.f(34), tw * (tw / totalW));
    const thumb = this.add.graphics();
    thumb.fillStyle(COLORS.gold, 0.9);
    thumb.fillRoundedRect(0, 0, thumbW, h, h / 2);
    thumb.y = ty;
    this.ui.add(thumb);

    this.scrollbar = { tx, tw, h, thumbW };
    this.scrollThumb = thumb;
    this.updateScrollThumb();
  }

  updateScrollThumb() {
    if (!this.scrollThumb || !this.handScroll || !this.handScroll.enabled) return;
    const { min, max } = this.handScroll;
    const t = max === min ? 0 : (this.handContainer.x - max) / (min - max); // 0=inicio, 1=final
    const { tx, tw, thumbW } = this.scrollbar;
    this.scrollThumb.x = tx + t * (tw - thumbW);
  }

  // Cartas jugadas en el centro. revealOwners=true muestra de quién es cada una.
  // Clásica en fase juzgar: solo las NO descartadas (re-centradas) + zona 🗑️.
  drawSubmissions(revealOwners, caption) {
    const classicJudging = this.phase === "judging" && this.mode !== "amarga";
    const humanIsJudge = this.judgeIndex === 0;

    // Índices visibles en la fila (en juzgar-clásica se ocultan los descartados).
    const visible = this.submissions
      .map((sub, i) => ({ sub, i }))
      .filter((o) => !(classicJudging && this.discardedIdx.has(o.i)));

    const n = visible.length;
    // Estas fases NO muestran la mano: las jugadas ocupan la banda libre BAJO el banner
    // (hasta el botón en resultado, o el borde inferior). Se escala para caber a lo
    // ancho Y a lo alto, y el rótulo va justo encima (sin chocar con el banner).
    const maxRowW = this.W * 0.96;
    const capH = caption ? this.f(54) : 0; // espacio reservado para el rótulo (separado de las cartas)
    const topAvail = this.yStatus + this.f(26) + capH;
    // En juez-clásico la zona de descarte ocupa el fondo → dejarle sitio.
    const discardH = classicJudging ? this.cardH * 0.4 + this.f(46) : 0;
    const botAvail =
      this.phase === "result" ? this.yButton - this.f(40) : this.H - discardH - this.f(24);
    const gap0 = Math.max(this.handGap, this.f(28));
    const widthScale = Math.min(1, maxRowW / (n * this.cardW + (n - 1) * gap0));
    const heightScale = (botAvail - topAvail) / this.cardH;
    const scale = Math.max(0.3, Math.min(widthScale, heightScale));
    const gap = gap0 * scale;
    const w = this.cardW * scale;
    const h = this.cardH * scale;
    const totalW = n * w + (n - 1) * gap;
    const startX = (this.W - totalW) / 2 + w / 2; // centros
    const cy = (topAvail + botAvail) / 2;

    if (caption) {
      // Justo debajo del banner (arriba): deja libre la franja sobre las cartas para
      // la corona, sin chocar con el banner.
      const capY = this.yStatus + this.f(56);
      const capText = this.add
        .text(this.W / 2, capY, caption, {
          fontFamily: FONT_DISPLAY,
          fontSize: `${this.f(26)}px`,
          color: COLORS.textMuted,
          letterSpacing: 0.5,
        })
        .setOrigin(0.5);
      this.ui.add(capText);
    }

    const canJudgeAmarga = this.phase === "judging" && humanIsJudge && this.mode === "amarga";

    visible.forEach(({ sub, i }, col) => {
      const cx = startX + col * (w + gap);
      const isWinner = this.lastResult && this.lastResult.card === sub.card;
      const isWorst = this.worstResult && this.worstResult.card === sub.card;
      const card = this.makeRedCard(sub.card, isWinner);
      card.setScale(scale);
      card.baseScale = scale;
      card.setPosition(cx, cy);

      if (classicJudging && humanIsJudge) {
        // Gestos de juez: tap→modal (ganadora/descartar) · arrastrar abajo→descartar.
        const img = card.cardImage;
        img.setInteractive({ useHandCursor: true });
        img.on("pointerover", () => {
          if (this._cardDrag || this.confirmLayer) return;
          card.setScale(scale * 1.06);
          this.ui.bringToTop(card);
        });
        img.on("pointerout", () => { if (!this._cardDrag) card.setScale(scale); });
        img.on("pointerdown", (p) => {
          if (this.confirmLayer || this._cardDrag) return;
          this._cardPress = { mode: "judge", i, text: sub.card, card, x: p.x, y: p.y };
          this._handDragged = false;
        });
      } else if (canJudgeAmarga) {
        // Amarga: durante el paso "peor" no se puede re-elegir la mejor.
        const blocked = this.judgingStep === "worst" && sub === this.bestPick;
        if (!blocked) this.attachClick(card, this.cardW, this.cardH, () => this.judgePick(i), scale);
      }

      if (isWinner) {
        // Corona DETRÁS de la carta ganadora: la carta va encima y la corona asoma por
        // arriba (reemplaza el tag "GANADORA"). Se agrega antes que la carta → detrás.
        const cw = w * 0.55;
        const chh = cw * (301 / 400);
        const crown = this.add
          .image(cx, cy - h / 2 + this.f(6), "corona")
          .setOrigin(0.5, 1)
          .setDisplaySize(cw, chh);
        this.ui.add(crown);
      }
      if (isWorst) {
        this.drawCardTag(cx, cy - h / 2 - this.f(12), "MAMÓN AMARGO 🤢", "#8a1c10", "#ffffff");
      }

      if (revealOwners) {
        const owner = this.add
          .text(cx, cy + h / 2 + this.f(14), this.players[sub.playerIndex].name, {
            fontFamily: FONT_UI,
            fontSize: `${this.f(15)}px`,
            color: isWinner ? COLORS.goldHex : "#cccccc",
            fontStyle: isWinner ? "bold" : "normal",
          })
          .setOrigin(0.5);
        this.ui.add(owner);
      }

      this.ui.add(card); // la carta va por encima de la corona
    });

    if (classicJudging) this.drawDiscardZone();
  }

  // Zona "Descartadas 🗑️" (abajo): caja + contador + stack de las descartadas.
  drawDiscardZone() {
    const discarded = this.submissions.map((_, i) => i).filter((i) => this.discardedIdx.has(i));
    const miniScale = 0.4;
    const miniW = this.cardW * miniScale;
    const miniH = this.cardH * miniScale;
    const zoneH = miniH + this.f(30);
    const zoneW = Math.min(this.W * 0.92, this.f(560));
    const cx = this.W / 2;
    const bottom = this.H - this.f(10);
    const top = bottom - zoneH;
    this.discardZone = { top, bottom, cx, w: zoneW };

    const zoneLeft = cx - zoneW / 2;
    const zoneRight = cx + zoneW / 2;

    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(zoneLeft, top, zoneW, zoneH, this.f(12));
    g.lineStyle(1.5, COLORS.panelBorder, 0.85);
    g.strokeRoundedRect(zoneLeft, top, zoneW, zoneH, this.f(12));
    this.ui.add(g);

    // Papelera (Pelón de cabeza en el bote): grande, a la izquierda, anclada al piso
    // de la zona; sobresale un poco hacia arriba para darle presencia.
    const pad = this.f(12);
    const papH = Math.min(zoneH * 1.4, zoneW * 0.34);
    const papCx = zoneLeft + pad + papH / 2;
    const pap = this.add
      .image(papCx, bottom - this.f(3), "papelera")
      .setOrigin(0.5, 1)
      .setDisplaySize(papH, papH);
    this.ui.add(pap);

    const contentLeft = papCx + papH / 2 + this.f(8);
    const label = this.add
      .text(contentLeft, top + this.f(14), `Descartadas (${discarded.length})`, {
        fontFamily: FONT_DISPLAY,
        fontSize: `${this.f(15)}px`,
        color: COLORS.textMuted,
        letterSpacing: 0.5,
      })
      .setOrigin(0, 0.5);
    this.ui.add(label);

    // Stack de mini-cartas descartadas (a la derecha de la papelera, centrado en
    // ese espacio; superpuesto si son muchas).
    const stackRegionR = zoneRight - this.f(14);
    const stackCx = (contentLeft + stackRegionR) / 2;
    const availW = Math.max(miniW, stackRegionR - contentLeft);
    const cyM = top + this.f(22) + miniH / 2;
    const nd = discarded.length;
    const stride = nd > 1
      ? Math.min(miniW + this.f(4), (availW - miniW) / (nd - 1))
      : 0;
    const stackW = miniW + (nd - 1) * stride;
    let x0 = stackCx - stackW / 2 + miniW / 2;
    discarded.forEach((idx, j) => {
      const mx = x0 + j * stride;
      const mini = this.makeRedCard(this.submissions[idx].card);
      mini.setPosition(mx, cyM);
      if (idx === this._lastDiscarded) {
        // Cae al 🗑️ desde arriba.
        mini.setPosition(mx, cyM - this.f(80));
        mini.setScale(miniScale * 1.3);
        mini.setAlpha(0);
        this.tweens.add({
          targets: mini, x: mx, y: cyM, scale: miniScale, alpha: 0.9,
          duration: 300, ease: "Back.easeOut",
        });
      } else {
        mini.setScale(miniScale);
        mini.setAlpha(0.9);
      }
      this.ui.add(mini);
    });
    this._lastDiscarded = null;
  }

  drawNextButton(text, onClick) {
    const w = this.f(250);
    const h = this.f(54);
    const container = this.add.container(this.W / 2, this.yButton);

    const g = this.add.graphics();
    g.fillStyle(COLORS.gold, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    container.add(g);

    const label = this.add
      .text(0, 0, text, {
        fontFamily: FONT_DISPLAY,
        fontSize: `${this.f(24)}px`,
        color: COLORS.dark,
        letterSpacing: 0.5,
      })
      .setOrigin(0.5);
    container.add(label);

    this.attachClick(container, w, h, onClick);
    this.ui.add(container);
  }

  // Etiqueta tipo "pill" sobre una carta (GANADORA / MAMÓN AMARGO).
  drawCardTag(cx, y, text, bgHex, fgHex) {
    const tag = this.add
      .text(cx, y, text, {
        fontFamily: FONT_DISPLAY,
        fontSize: `${this.f(15)}px`,
        color: fgHex,
        backgroundColor: bgHex,
        letterSpacing: 0.5,
        padding: { x: 8, y: 3 },
      })
      .setOrigin(0.5);
    this.ui.add(tag);
  }

  // Reverso de carta (marca): fondo verde + borde dorado + el logo centrado.
  // Se usa en "Pela el ojo" y en las boca-abajo del montoncito.
  // Reverso (dorso) por capas — el wordmark horneado. `color` = "roja" (mano/montón)
  // o "verde". Placeholder de color base mientras carga el WebP.
  makeCardBack(w, h, color = "roja") {
    const c = this.add.container(0, 0);
    const img = this.add
      .image(0, 0, this.ensurePlaceholderTexture(color))
      .setOrigin(0.5)
      .setDisplaySize(w, h);
    c.add(this.cardShadow(w, h));
    c.add(img);
    this.applyReversoTexture(img, color, w, h);
    c.add(this.cardKeyline(w, h));
    return c;
  }

  // ---------- Realce de la carta sobre el fieltro (separación figura-fondo) ----------
  // El fondo verde de la carta (#1A4629, horneado en los WebP) casi iguala al fieltro
  // (#1f4d2e→#10301d), así que la SILUETA se funde. No se recolorea el arte: se separa
  // a nivel de sprite con sombra proyectada (flota) + filo dorado (traza el borde).
  // Radio ~5% del ancho = el mismo redondeo horneado en el WebP, a cualquier tamaño.
  cardRadius(w) {
    return Math.max(6, Math.round(w * 0.05));
  }

  // Sombra proyectada suave: rounded-rects apilados (blur falso) desplazados hacia abajo.
  // Sustituye la elipse de contacto: la carta lee como objeto físico sobre la mesa.
  cardShadow(w, h) {
    const g = this.add.graphics();
    const r = this.cardRadius(w);
    const dy = this.f(6);
    const layers = [
      { grow: this.f(7), alpha: 0.1 },
      { grow: this.f(4), alpha: 0.14 },
      { grow: this.f(1.5), alpha: 0.2 },
    ];
    for (const L of layers) {
      g.fillStyle(0x000000, L.alpha);
      g.fillRoundedRect(-w / 2 - L.grow, -h / 2 + dy - L.grow, w + L.grow * 2, h + L.grow * 2, r + L.grow);
    }
    return g;
  }

  // Filo (keyline) dorado que traza la silueta de la carta y la corta del fieltro.
  cardKeyline(w, h) {
    const g = this.add.graphics();
    g.lineStyle(Math.max(1.5, this.f(1.5)), COLORS.gold, 0.9);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, this.cardRadius(w));
    return g;
  }

  // ---------- Jugar carta: arrastrar al centro (directo) / tap (confirmar) ----------
  // Empieza a arrastrar la carta bajo el press: oculta la original y crea un clon en
  // animLayer (sin máscara) que sigue el puntero.
  _beginCardDrag(p) {
    const { mode, i, text, card } = this._cardPress;
    this._cardPress = null;
    this._dragging = false; // cortar el scroll
    this._handVel = 0;
    const orig = card || (this.handContainer && this.handContainer.list[i]);
    if (orig) orig.setVisible(false);
    const clone = this.makeRedCard(text);
    clone.setPosition(p.x, p.y);
    clone.setScale(1.12);
    clone.setAlpha(0.96);
    this.animLayer.add(clone);
    this._cardDrag = { mode, i, text, card: clone, orig };
  }

  // ¿El puntero está en la zona destino del arrastre? play=arriba (centro), judge=🗑️.
  _inDropZone(p, mode) {
    return mode === "judge"
      ? !!(this.discardZone && p.y > this.discardZone.top)
      : !!(this.handBand && p.y < this.handBand.top);
  }

  _dragCardFollow(p) {
    const d = this._cardDrag;
    if (!d || !d.card.scene) return;
    d.card.setPosition(p.x, p.y);
    d.card.setScale(this._inDropZone(p, d.mode) ? 1.22 : 1.12); // realce en la zona
  }

  _endCardDrag(p) {
    const d = this._cardDrag;
    this._cardDrag = null;
    if (d.card && d.card.scene) d.card.destroy();
    if (this._inDropZone(p, d.mode)) {
      if (d.mode === "judge") this.discardSubmission(d.i);
      else this.humanPlayCard(d.i);
    } else if (d.orig && d.orig.scene) {
      d.orig.setVisible(true); // se suelta fuera → vuelve a su sitio
      d.orig.setScale(d.orig.baseScale || 1);
      // Restaurar su orden original en el solape (el hover pudo traerla al frente).
      if (this.handContainer && d.orig.parentContainer === this.handContainer) {
        this.handContainer.moveTo(d.orig, d.i);
      }
    }
  }

  // Modal genérico: carta grande centrada + título + N botones. Cada botón cierra el
  // modal y ejecuta su onClick. Tocar fuera (dim) cancela.
  openCardModal(text, title, buttons) {
    if (this.confirmLayer) return;
    const layer = this.add.container(0, 0);
    this.confirmLayer = layer;

    const dim = this.add.graphics();
    dim.fillStyle(0x000000, 0.74);
    dim.fillRect(0, 0, this.W, this.H);
    dim.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, this.W, this.H),
      Phaser.Geom.Rectangle.Contains
    );
    dim.on("pointerup", () => this.closeConfirm());
    layer.add(dim);

    // Carta grande (textura por capas, nítida).
    const bigH = Math.min(this.H * 0.5, this.W * 0.8 * CARD_RATIO);
    const scale = bigH / this.cardH;
    const cy = this.H * 0.42;
    const card = this.makeRedCard(text);
    card.setPosition(this.W / 2, cy);
    card.setScale(scale);
    layer.add(card);

    const q = this.add
      .text(this.W / 2, cy - bigH / 2 - this.f(24), title, {
        fontFamily: FONT_UI,
        fontSize: `${this.f(18)}px`,
        color: COLORS.textLight,
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: this.W * 0.9 },
      })
      .setOrigin(0.5);
    layer.add(q);

    // Botones en fila centrada bajo la carta.
    const by = cy + bigH / 2 + this.f(32);
    const bh = this.f(46);
    const gap = this.f(12);
    const bw = Math.min(this.f(200), (this.W * 0.94 - gap * (buttons.length - 1)) / buttons.length);
    const totalW = buttons.length * bw + (buttons.length - 1) * gap;
    let x = this.W / 2 - totalW / 2 + bw / 2;
    for (const b of buttons) {
      this.drawMiniButton(x, by, bw, bh, b.label, () => { this.closeConfirm(); b.onClick(); }, !!b.primary, layer);
      x += bw + gap;
    }
  }

  // Modal al tocar una carta de la mano: jugar / cancelar.
  openPlayConfirm(i, text) {
    if (this.confirmLayer) return;
    if (this.phase !== "play" || this.judgeIndex === 0 || this._animatingPlay) return;
    if (this.humanSubmittedCount() >= this.humanPlaysNeeded) return;
    this._handModalOpen = true; // al cerrar, resetear el orden/escala de la mano
    this.openCardModal(text, "¿Quieres jugar esta carta?", [
      { label: "Sí, jugar", primary: true, onClick: () => this.humanPlayCard(i) },
      { label: "Cancelar", primary: false, onClick: () => {} },
    ]);
  }

  // Modal al tocar una jugada siendo Juez (Clásica): ganadora / descartar / cancelar.
  openJudgeConfirm(i, text) {
    if (this.confirmLayer) return;
    if (this.phase !== "judging" || this.judgeIndex !== 0 || this.mode === "amarga") return;
    if (this.discardedIdx.has(i)) return;
    this._handModalOpen = true; // al cerrar, resetear el orden/escala de las jugadas
    this.openCardModal(text, "¿Qué haces con esta carta?", [
      { label: "Escoger como ganadora", primary: true, onClick: () => this.chooseWinner(i) },
      { label: "Descartar esta carta", primary: false, onClick: () => this.discardSubmission(i) },
      { label: "Cancelar", primary: false, onClick: () => {} },
    ]);
  }

  closeConfirm() {
    if (this.confirmLayer) {
      this.confirmLayer.destroy(true);
      this.confirmLayer = null;
    }
    // Si venía de un modal de la mano/jugadas, re-renderiza para resetear el orden y
    // la escala de las cartas (el hover previo pudo dejar alguna al frente/agrandada).
    if (this._handModalOpen) {
      this._handModalOpen = false;
      if (this.players && this.players.length && (this.phase === "play" || this.phase === "judging")) {
        this.render();
      }
    }
  }

  // Mini botón (por defecto se añade a this.ui; el overlay pasa su propia capa).
  drawMiniButton(cx, cy, w, h, text, onClick, primary = true, parent = this.ui) {
    const c = this.add.container(cx, cy);
    const g = this.add.graphics();
    g.fillStyle(primary ? COLORS.gold : 0x2a3a2c, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    if (!primary) {
      g.lineStyle(2, COLORS.panelBorder, 1);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    }
    c.add(g);
    const t = this.add
      .text(0, 0, text, {
        fontFamily: FONT_DISPLAY,
        fontSize: `${this.f(17)}px`,
        color: primary ? COLORS.dark : COLORS.textLight,
        letterSpacing: 0.5,
      })
      .setOrigin(0.5);
    c.add(t);
    this.attachClick(c, w, h, onClick);
    parent.add(c);
  }

  // ---------------------------------------------------------------------------
  // La Ruleta del Mamón Amargo: overlay animado (rueda que gira y se detiene).
  // ---------------------------------------------------------------------------

  rouletteText(parent, cx, y, text, size, color, bold, wrapW) {
    const t = this.add
      .text(cx, y, text, {
        fontFamily: FONT_UI,
        fontSize: `${this.f(size)}px`,
        color,
        fontStyle: bold ? "bold" : "normal",
        align: "center",
        wordWrap: wrapW ? { width: wrapW } : undefined,
      })
      .setOrigin(0.5);
    parent.add(t);
    return t;
  }

  // Construye la rueda de 6 sectores con su emoji. Centrada en (cx, cy).
  // Construye la rueda con un sector por efecto activo (5 ó 6). Centrada en (cx, cy).
  buildWheel(cx, cy, rW, efectos) {
    const wheel = this.add.container(cx, cy);
    const n = efectos.length;
    const seg = 360 / n;

    const g = this.add.graphics();
    for (let k = 0; k < n; k++) {
      const a0 = Phaser.Math.DegToRad(k * seg);
      const a1 = Phaser.Math.DegToRad((k + 1) * seg);
      g.fillStyle(RULETA_COLORS[efectos[k] - 1], 1);
      g.slice(0, 0, rW, a0, a1, false);
      g.fillPath();
    }
    g.lineStyle(3, 0x0c2114, 1);
    g.strokeCircle(0, 0, rW);
    wheel.add(g);

    for (let k = 0; k < n; k++) {
      const ac = Phaser.Math.DegToRad((k + 0.5) * seg);
      const er = rW * 0.62;
      const e = this.add
        .text(Math.cos(ac) * er, Math.sin(ac) * er, RULETA_EFFECTS[efectos[k]].emoji, {
          fontSize: `${Math.round(rW * 0.34)}px`,
        })
        .setOrigin(0.5);
      wheel.add(e);
    }

    const hub = this.add.graphics();
    hub.fillStyle(0x0c2114, 1);
    hub.fillCircle(0, 0, rW * 0.16);
    wheel.add(hub);
    return wheel;
  }

  // Crea el overlay y lanza el giro; al terminar revela el efecto.
  showRoulette() {
    if (this.rouletteLayer) this.rouletteLayer.destroy(true);
    const layer = this.add.container(0, 0);
    this.rouletteLayer = layer;
    const r = this.pendingRoulette;

    // Scrim interactivo (bloquea clics a lo de debajo gracias a topOnly).
    const scrim = this.add.graphics();
    scrim.fillStyle(0x000000, 0.62);
    scrim.fillRect(0, 0, this.W, this.H);
    scrim.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, this.W, this.H),
      Phaser.Geom.Rectangle.Contains
    );
    layer.add(scrim);

    const pw = Math.min(this.f(460), this.W * 0.9);
    const rW = Math.max(this.f(42), Math.min(this.f(82), this.H * 0.13, this.W * 0.2));
    const extra = r.transfer ? this.f(150) : this.f(112);
    const ph = Math.min(this.H * 0.92, this.f(70) + 2 * rW + extra);
    const cx = this.W / 2;
    const cyP = this.H / 2;
    const top = cyP - ph / 2;

    const panel = this.add.graphics();
    panel.fillStyle(COLORS.panel, 0.98);
    panel.fillRoundedRect(cx - pw / 2, top, pw, ph, 18);
    panel.lineStyle(3, COLORS.gold, 1);
    panel.strokeRoundedRect(cx - pw / 2, top, pw, ph, 18);
    layer.add(panel);

    this.rouletteText(layer, cx, top + this.f(24), "🎡 ¡Ruleta del Mamón Amargo!", 18, COLORS.goldHex, true);
    this.rouletteText(
      layer,
      cx,
      top + this.f(48),
      `${this.players[r.playerIndex].name} gira la ruleta...`,
      13,
      COLORS.textMuted,
      false
    );

    const efectos = r.efectos || [1, 2, 3, 4, 5, 6];
    const seg = 360 / efectos.length;
    const wheelCY = top + this.f(64) + rW;
    const wheel = this.buildWheel(cx, wheelCY, rW, efectos);
    layer.add(wheel);
    this.rouletteWheel = wheel;

    // Puntero fijo (no gira) sobre la rueda.
    const ptr = this.add.graphics();
    ptr.fillStyle(0xffffff, 1);
    ptr.fillTriangle(
      cx - this.f(11),
      wheelCY - rW - this.f(16),
      cx + this.f(11),
      wheelCY - rW - this.f(16),
      cx,
      wheelCY - rW + this.f(3)
    );
    layer.add(ptr);

    this._rouletteGeom = { cx, top, pw, ph, rW, wheelCY };

    // Gira hasta dejar el segmento elegido bajo el puntero (arriba = -90°).
    const idx = efectos.indexOf(r.pick);
    const segCenter = (Math.max(0, idx) + 0.5) * seg;
    const target = 360 * 5 + (-90 - segCenter);
    wheel.angle = 0;
    this.tweens.add({
      targets: wheel,
      angle: target,
      duration: REDUCED_MOTION ? 200 : 2600,
      ease: "Cubic.easeOut",
      onComplete: () => this.revealRouletteResult(),
    });
  }

  // Tras detenerse la rueda: muestra el efecto y los botones de acción.
  revealRouletteResult() {
    const r = this.pendingRoulette;
    if (!r || !this.rouletteLayer) return;
    const { cx, top, pw, ph, rW, wheelCY } = this._rouletteGeom;
    const layer = this.rouletteLayer;
    const bottom = top + ph;

    const nameY = wheelCY + rW + this.f(22);
    this.rouletteText(layer, cx, nameY, `${r.fx.emoji} ${r.fx.name}`, 18, COLORS.textLight, true);
    this.rouletteText(layer, cx, nameY + this.f(22), r.fx.desc, 12, COLORS.textMuted, false, pw - this.f(36));

    // 🤢 Pasa el mamón en manos de un BOT: se lo pasa solo a alguien al azar.
    if (r.transfer && this.players[r.playerIndex].isBot) {
      const others = this.players.map((_, i) => i).filter((i) => i !== r.playerIndex);
      const target = others[Phaser.Math.Between(0, others.length - 1)];
      this.rouletteText(layer, cx, bottom - this.f(28), `Se lo pasa a ${this.players[target].name}...`, 13, COLORS.goldHex, true);
      this.time.delayedCall(1300, () => {
        this.closeRoulette(false);
        this.activarRuletaMamonAmargo(target, r.depth + 1);
      });
      return;
    }

    if (r.transfer) {
      this.rouletteText(layer, cx, bottom - this.f(84), "Pásaselo a:", 14, COLORS.textLight, true);
      const others = this.players.map((_, i) => i).filter((i) => i !== r.playerIndex);
      const bw = this.f(120);
      const bh = this.f(34);
      const g = this.f(12);
      const total = others.length * bw + (others.length - 1) * g;
      let bx = cx - total / 2 + bw / 2;
      const by = bottom - this.f(54);
      others.forEach((oi) => {
        this.drawMiniButton(
          bx,
          by,
          bw,
          bh,
          this.players[oi].name,
          () => {
            const d = r.depth;
            this.closeRoulette(false);
            this.activarRuletaMamonAmargo(oi, d + 1);
          },
          true,
          layer
        );
        bx += bw + g;
      });
      this.drawMiniButton(
        cx,
        bottom - this.f(18),
        this.f(180),
        this.f(30),
        "Me salvo (nada pasa)",
        () => this.closeRoulette(true),
        false,
        layer
      );
    } else {
      this.drawMiniButton(
        cx,
        bottom - this.f(30),
        this.f(160),
        this.f(40),
        "¡Dale!",
        () => this.closeRoulette(true),
        true,
        layer
      );
    }
  }

  closeRoulette(rerender) {
    if (this.rouletteLayer) {
      this.rouletteLayer.destroy(true);
      this.rouletteLayer = null;
    }
    this.rouletteWheel = null;
    this.pendingRoulette = null;
    if (rerender) this.render();
  }

  // ---------------------------------------------------------------------------
  // Helpers de cartas (geometría CENTRADA: origen 0.5 → escala/hover sin desfase)
  // ---------------------------------------------------------------------------

  // Reduce el tamaño de fuente de un texto hasta que su alto entre en maxHeight
  // (o se llegue al mínimo). Evita que el título invada la ilustración.
  fitText(textObj, maxHeight, minFontPx) {
    let px = parseInt(textObj.style.fontSize, 10) || 14;
    while (textObj.height > maxHeight && px > minFontPx) {
      px -= 1;
      textObj.setFontSize(px);
    }
  }

  // Carta amarilla (sustantivo): cara POR CAPAS (fondo por pose + título rotado +
  // flavor), igual que el online. La textura se rasteriza y cachea bajo demanda.
  makeRedCard(text, isWinner) {
    const w = this.cardW;
    const h = this.cardH;
    const container = this.add.container(0, 0);

    container.add(this.cardShadow(w, h));

    const img = this.add
      .image(0, 0, this.ensurePlaceholderTexture("roja"))
      .setOrigin(0.5)
      .setDisplaySize(w, h);
    container.add(img);
    container.cardImage = img; // referencia para la zona clickeable (toda la carta)
    // Cara POR CAPAS (fondo por pose + título/flavor); reemplaza el placeholder al cargar.
    this.applyCardTexture(img, "roja", text, w, h);
    container.add(this.cardKeyline(w, h)); // filo dorado: separa del fieltro

    if (isWinner) {
      const border = this.add.graphics();
      border.lineStyle(4, COLORS.gold, 1);
      // Radio proporcional (~5% del ancho), alineado al redondeo horneado del WebP.
      border.strokeRoundedRect(-w / 2, -h / 2, w, h, this.cardRadius(w));
      container.add(border);
    }

    return container;
  }

  // Hace clicable toda la carta. Si el contenedor tiene una imagen de carta,
  // se usa esa imagen (su zona de clic es exactamente toda la carta); si no
  // (p. ej. el botón), se usa un rectángulo centrado del tamaño dado.
  attachClick(container, w, h, onClick, baseScale = 1) {
    // Cartas: la imagen ya trae su hit-area (toda la carta). Botones/otros: un
    // rectángulo invisible interactivo dentro del contenedor = hit-area fiable y
    // centrada que cubre TODO el botón (el hitArea manual sobre el contenedor fallaba).
    let target = container.cardImage;
    if (!target) {
      target = this.add.rectangle(0, 0, w, h, 0x000000, 0); // fillAlpha 0 (invisible)
      container.add(target); // encima de fondo+texto → captura el clic en toda el área
    }
    target.setInteractive({ useHandCursor: true });

    target.on("pointerover", () => {
      container.setScale(baseScale * 1.08);
      (container.parentContainer || this.ui).bringToTop(container);
    });
    target.on("pointerout", () => container.setScale(baseScale));
    // En pointerUP (no down): así, al re-renderizar tras el clic, la MISMA
    // pulsación no se encadena a una carta recién dibujada bajo el cursor.
    target.on("pointerup", onClick);
  }
}
