// Rasteriza la cara de una carta POR CAPAS a un <canvas>, para usarla como textura en
// Phaser (single-player). Reutiliza la MISMA geometría/estilos que el online: el fondo
// WebP por (color, pose) + el SVG de texto vivo de cardLayout.js. Así SP y online se ven
// idénticos y hay una sola fuente de verdad del layout.
//
// Detalle clave de fuentes: un SVG rasterizado vía <img> corre en contexto aislado y NO
// ve las @font-face del documento. Por eso embebemos las 3 TTF (base64) dentro del propio
// SVG. Se calcula UNA vez y se cachea (embeddedFontCSS).
import { poseFor, bgUrl, cardArtSVG, reversoUrl, cardFontsReady } from "./cardLayout.js";
import FLAVORS from "../game/data/flavors.json";

export const CARD_W = 1623;
export const CARD_H = 2485;
export const CARD_RATIO = CARD_H / CARD_W; // alto/ancho

export { poseFor, reversoUrl, cardFontsReady };

// Flavor por color+texto (bundle del SP; el online lo trae de D1).
export function flavorFor(color, texto) {
  const map = FLAVORS[color] || {};
  return map[texto] || map[String(texto).trim()] || "";
}

// ---------- Fuentes embebidas (base64) para el SVG rasterizado ----------
// Fuentes que aparecen en la cara: Teko 700 (título/píldora, condensada) + Montserrat
// 600 italic (flavor). Se embeben en el SVG rasterizado (un <img>-SVG no ve las
// @font-face del doc). Teko reemplazó a Bebas en las cartas (Bebas sigue en la UI).
const FONT_DEFS = [
  { family: "Teko", weight: 700, style: "normal", url: "/fonts/Teko-700.woff2", mime: "font/woff2", fmt: "woff2" },
  { family: "Montserrat", weight: 600, style: "italic", url: "/fonts/Montserrat-600-Italic.woff2", mime: "font/woff2", fmt: "woff2" },
];

let _fontCssPromise = null;
async function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
export function embeddedFontCSS() {
  if (!_fontCssPromise) {
    _fontCssPromise = Promise.all(
      FONT_DEFS.map(async (f) => {
        const res = await fetch(f.url);
        const b64 = await bufToBase64(await res.arrayBuffer());
        return `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};src:url(data:${f.mime};base64,${b64}) format("${f.fmt}");}`;
      })
    ).then((blocks) => blocks.join(""));
  }
  return _fontCssPromise;
}

// ---------- Carga de imágenes ----------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function loadSvgImage(svg) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return loadImage(url).finally(() => URL.revokeObjectURL(url));
}

// Envuelve el SVG de cardLayout con el bloque <style> de fuentes embebidas.
function withFonts(svg, css) {
  return svg.replace('class="carta__svg">', `class="carta__svg"><style>${css}</style>`);
}

// ---------- API pública ----------
// Cara de la carta (fondo por capas + título/píldora/flavor) → <canvas> pxW × pxW·ratio.
export async function cardFaceCanvas({ color, texto, flavor, pxW }) {
  await cardFontsReady; // para que ctx.measureText del SVG mida con la fuente real
  const css = await embeddedFontCSS();

  const pxH = Math.round(pxW * CARD_RATIO);
  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext("2d");

  // Capa 1: fondo WebP por (color, pose).
  const pose = poseFor(color, texto);
  const bg = bgUrl(color, pose);
  if (bg) {
    try {
      const bgImg = await loadImage(bg);
      ctx.drawImage(bgImg, 0, 0, pxW, pxH);
    } catch { /* sin fondo: se ve el SVG sobre transparente */ }
  }

  // Capa 2: texto vivo (SVG con fuentes embebidas).
  const svg = withFonts(cardArtSVG({ color, texto, flavor: flavor ?? flavorFor(color, texto) }), css);
  const svgImg = await loadSvgImage(svg);
  ctx.drawImage(svgImg, 0, 0, pxW, pxH);

  return canvas;
}

// Reverso (dorso) por color → <canvas>. No lleva texto/fuentes, solo el WebP.
export async function reversoCanvas({ color, pxW }) {
  const pxH = Math.round(pxW * CARD_RATIO);
  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext("2d");
  const img = await loadImage(reversoUrl(color));
  ctx.drawImage(img, 0, 0, pxW, pxH);
  return canvas;
}
