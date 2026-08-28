// Layout de la carta POR CAPAS para el juego (online).
// Porta la geometría EXACTA del generador de imágenes (scripts/gen-cartas-img.mjs):
// el fondo (base+patrón+barra+figura) se sirve como WebP por (color, pose) y aquí
// pintamos el título/píldora/flavor como texto VIVO en un <svg viewBox="0 0 1623 2485">.
// El auto-ajuste (fitText/wrapFit/2-columnas) se replica midiendo con canvas 2D.
import POSES from "../game/data/poses.json";

// ---------- Lienzo / colores (igual que el generador) ----------
const W = 1623, H = 2485;
const BG_VERDE = "#1A4629";

// ---------- Geometría VERDE (adjetivos) ----------
const TITULO = { cx: 250, topY: 100, size: 345, ls: 14, maxLen: 2250 };
const PILDORA = { rightX: 1555, cy: 1830, h: 196, padX: 72, ls: 8, size: 160, maxW: 1060, textDy: 8 };
const FLAVOR = { rightX: 1488, baseline1: 2165, gap: 183.65, size: 153.04, maxW: 790 };

// ---------- Geometría AMARILLA/ROJA (sustantivos) ----------
const TITULO_A = { cx: 256, topY: 150, barMid: (43 + 2416) / 2, size: 330, ls: 12, maxLen: 2230, min1Line: 158, colGapFactor: 1.12, maxBlockW: 330 };
const FLAVOR_A = { rightX: 1500, boxTop: 1770, boxH: 560, maxW: 760, baseSize: 150, lineRatio: 1.16, minSize: 60 };

// ---------- Fuentes: strings para canvas ctx.font ----------
const bebasFor = (s) => `${s}px "Bebas Neue"`;
const mont200For = (s) => `italic 200 ${s}px "Montserrat"`;
const mont400For = (s) => `italic 400 ${s}px "Montserrat"`;

// Espera a que las fuentes propias estén listas antes de medir (si no, canvas mide con fallback).
export const cardFontsReady =
  typeof document !== "undefined" && document.fonts
    ? Promise.all([
        document.fonts.load('400 40px "Bebas Neue"'),
        document.fonts.load('italic 200 40px "Montserrat"'),
        document.fonts.load('italic 400 40px "Montserrat"'),
      ]).then(() => document.fonts.ready)
    : Promise.resolve();

// ---------- Medición (canvas 2D, mismo modelo que el generador: advance + n·ls) ----------
let _ctx = null;
function ctx() {
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  return _ctx;
}
function measure(fontFor, text, size, ls = 0) {
  const c = ctx();
  c.font = fontFor(size);
  return c.measureText(text).width + text.length * ls;
}
// Reduce tamaño+tracking proporcionalmente si no cabe en maxLen.
function fitText(fontFor, text, size, ls, maxLen) {
  const natural = measure(fontFor, text, size, ls);
  if (natural <= maxLen) return { size, ls };
  const s = maxLen / natural;
  return { size: size * s, ls: ls * s };
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- Word-wrap + auto-fit del flavor amarilla (frase) ----------
function wrapFit(fontFor, text, { maxW, boxH, baseSize, lineRatio, minSize }) {
  const wrap = (size) => {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const wd of words) {
      const cand = cur ? cur + " " + wd : wd;
      if (!cur || measure(fontFor, cand, size) <= maxW) cur = cand;
      else { lines.push(cur); cur = wd; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  for (let size = baseSize; size >= minSize; size -= 3) {
    const gap = size * lineRatio;
    const lines = wrap(size);
    const widest = Math.max(0, ...lines.map((l) => measure(fontFor, l, size)));
    if (lines.length * gap <= boxH && widest <= maxW) return { size, gap, lines };
  }
  const size = minSize;
  return { size, gap: size * lineRatio, lines: wrap(size) };
}

// Parte un título en 2 líneas: la 1ª (derecha, se lee primero) >= 2ª, lo más balanceado posible.
function splitTwoLines(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text, ""];
  let best = -1, bestDiff = Infinity;
  for (let k = 1; k < words.length; k++) {
    const l1 = words.slice(0, k).join(" ").length;
    const l2 = words.slice(k).join(" ").length;
    if (l1 < l2) continue;
    const d = l1 - l2;
    if (d < bestDiff) { bestDiff = d; best = k; }
  }
  if (best === -1) {
    bestDiff = Infinity;
    for (let k = 1; k < words.length; k++) {
      const d = Math.abs(words.slice(0, k).join(" ").length - words.slice(k).join(" ").length);
      if (d < bestDiff) { bestDiff = d; best = k; }
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

// Título amarilla rotado (+90, arriba→abajo). 1 línea grande o 2 columnas si es largo.
function amarillaTitle(titulo) {
  const A = TITULO_A;
  const startYFor = (len) => Math.min(A.topY, A.barMid - len / 2);
  const col = (cx, txt, size, ls, startY) =>
    `<g transform="translate(${cx.toFixed(1)},${startY.toFixed(1)}) rotate(90)"><text x="0" y="0" font-family="Bebas Neue" font-size="${size}" letter-spacing="${ls}" fill="#fff" text-anchor="start" dominant-baseline="central">${esc(txt)}</text></g>`;

  const one = fitText(bebasFor, titulo, A.size, A.ls, A.maxLen);
  if (one.size >= A.min1Line || !titulo.includes(" ")) {
    const len = measure(bebasFor, titulo, one.size, one.ls);
    return col(A.cx, titulo, one.size, one.ls, startYFor(len));
  }
  const [l1, l2] = splitTwoLines(titulo);
  const f1 = fitText(bebasFor, l1, A.size, A.ls, A.maxLen);
  const f2 = fitText(bebasFor, l2, A.size, A.ls, A.maxLen);
  const capByWidth = A.maxBlockW / (1 + A.colGapFactor);
  const size = Math.min(f1.size, f2.size, capByWidth);
  const ls = A.ls * (size / A.size);
  const colGap = A.colGapFactor * size;
  const startY = startYFor(Math.max(measure(bebasFor, l1, size, ls), measure(bebasFor, l2, size, ls)));
  return col(A.cx + colGap / 2, l1, size, ls, startY) + col(A.cx - colGap / 2, l2, size, ls, startY);
}

// SVG interior AMARILLA/ROJA (sin píldora; flavor = frase word-wrap centrada vertical).
function svgAmarilla(texto, flavor) {
  const titulo = String(texto).toUpperCase();
  const t = amarillaTitle(titulo);
  const fl = wrapFit(mont400For, flavor || "", FLAVOR_A);
  const totalH = fl.lines.length * fl.gap;
  const startBaseline = FLAVOR_A.boxTop + (FLAVOR_A.boxH - totalH) / 2 + fl.size * 0.78;
  const lines = fl.lines
    .map((s, i) =>
      `<text x="${FLAVOR_A.rightX}" y="${startBaseline + i * fl.gap}" font-family="Montserrat" font-style="italic" font-weight="400" font-size="${fl.size}" fill="#fff" text-anchor="end">${esc(s)}</text>`
    )
    .join("");
  return t + lines;
}

// SVG interior VERDE (píldora con la palabra calada + flavor 2 sinónimos, derecha).
function svgVerde(texto, sinonimos) {
  const titulo = String(texto).toUpperCase();
  const tFit = fitText(bebasFor, titulo, TITULO.size, TITULO.ls, TITULO.maxLen);
  const pFit = fitText(bebasFor, titulo, PILDORA.size, PILDORA.ls, PILDORA.maxW - PILDORA.padX * 2);
  const wordW = measure(bebasFor, titulo, pFit.size, pFit.ls);
  const pillW = wordW + PILDORA.padX * 2;
  const pillX = PILDORA.rightX - pillW;
  const pillY = PILDORA.cy - PILDORA.h / 2;
  const rx = PILDORA.h / 2;
  const flavorLines = (sinonimos || [])
    .map((s, i) => {
      const fFit = fitText(mont200For, s, FLAVOR.size, 0, FLAVOR.maxW);
      return `<text x="${FLAVOR.rightX}" y="${FLAVOR.baseline1 + i * FLAVOR.gap}" font-family="Montserrat" font-style="italic" font-weight="200" font-size="${fFit.size}" fill="#fff" text-anchor="end">${esc(s)}</text>`;
    })
    .join("");
  return (
    `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${PILDORA.h}" rx="${rx}" ry="${rx}" fill="#fff"/>` +
    `<text x="${PILDORA.rightX - PILDORA.padX}" y="${PILDORA.cy + PILDORA.textDy}" font-family="Bebas Neue" font-size="${pFit.size}" letter-spacing="${pFit.ls}" fill="${BG_VERDE}" text-anchor="end" dominant-baseline="central">${esc(titulo)}</text>` +
    `<g transform="translate(${TITULO.cx},${TITULO.topY}) rotate(90)"><text x="0" y="0" font-family="Bebas Neue" font-size="${tFit.size}" letter-spacing="${tFit.ls}" fill="#fff" text-anchor="start" dominant-baseline="central">${esc(titulo)}</text></g>` +
    flavorLines
  );
}

// Flavor verde = sinónimos separados por salto de línea; se usan los 2 primeros.
function splitSinonimos(flavor) {
  return String(flavor || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2);
}

// La pose (categoría→figura) por color+texto, para elegir el fondo WebP.
export function poseFor(color, texto) {
  const map = POSES[color] || {};
  return map[texto] || map[String(texto).trim()] || "";
}

// URL del fondo por capa (base+patrón+barra+figura, sin texto).
export function bgUrl(color, pose) {
  return pose ? `/assets/cartas/bg/${color}-${pose}.webp` : "";
}

// URL del reverso (dorso) por color: verde (adjetivo) o roja (sustantivo).
export function reversoUrl(color) {
  return `/assets/cartas/reverso-${color === "verde" ? "verde" : "roja"}.webp`;
}

// SVG interior (texto vivo) para la carta. Requiere fuentes listas para medir bien.
export function cardArtSVG({ color, texto, flavor }) {
  const inner = color === "verde" ? svgVerde(texto, splitSinonimos(flavor)) : svgAmarilla(texto, flavor);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="carta__svg">${inner}</svg>`;
}
