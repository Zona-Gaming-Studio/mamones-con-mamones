// Layout de la carta POR CAPAS para el juego (online).
// Porta la geometría EXACTA del generador de imágenes (scripts/gen-cartas-img.mjs):
// el fondo (base+patrón+barra+figura) se sirve como WebP por (color, pose) y aquí
// pintamos el título/píldora/flavor como texto VIVO en un <svg viewBox="0 0 1623 2485">.
// El auto-ajuste (fitText/wrapFit/2-columnas) se replica midiendo con canvas 2D.
import POSES from "../game/data/poses.json";

// ---------- Lienzo / colores (igual que el generador) ----------
const W = 1623, H = 2485;
const BG_VERDE = "#1A4629";
// Color del título en la barra amarilla (#FCC740, muy clara): verde fieltro para contraste
// legible (~9:1). El título verde sigue en blanco sobre su barra #559D33 (media-oscura).
const TITULO_A_FILL = "#16331f";

// ---------- Geometría VERDE (adjetivos) ----------
// Título rotado a 480 (Teko). Barra ~416px de ancho; Teko cap con acentos ~0.78·size
// => 374px (~90% de la barra, margen para tildes/ñ). Solo agranda los títulos cortos;
// los largos igual encogen con fitText para caber en maxLen. (Teko cap=622 vs Bebas 700.)
const TITULO = { cx: 250, topY: 100, size: 480, ls: 14, maxLen: 2250 };
const PILDORA = { rightX: 1555, cy: 1830, h: 196, padX: 72, ls: 8, size: 200, maxW: 1060, textDy: 8 };
const FLAVOR = { rightX: 1488, baseline1: 2165, gap: 183.65, size: 153.04, maxW: 790 };

// ---------- Geometría AMARILLA/ROJA (sustantivos) ----------
const TITULO_A = { cx: 256, topY: 150, barMid: (43 + 2416) / 2, size: 480, ls: 12, maxLen: 2230, min1Line: 158, colGapFactor: 1.12, maxBlockW: 330 };
const FLAVOR_A = { rightX: 1500, boxTop: 1770, boxH: 560, maxW: 760, baseSize: 150, lineRatio: 1.16, minSize: 60 };

// ---------- Fuentes: strings para canvas ctx.font ----------
// Título/píldora = Teko 700 (condensada, alta, con peso real; reemplazó a Bebas).
const tekoFor = (s) => `700 ${s}px "Teko"`;
const mont600For = (s) => `italic 600 ${s}px "Montserrat"`; // flavor: SemiBold, legible en pequeño

// Espera a que las fuentes propias estén listas antes de medir (si no, canvas mide con fallback).
export const cardFontsReady =
  typeof document !== "undefined" && document.fonts
    ? Promise.all([
        document.fonts.load('700 40px "Teko"'),
        document.fonts.load('italic 600 40px "Montserrat"'),
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

// ---------- Título rotado: centrado por mayúscula + tope por ancho de barra ----------
// Métricas Teko (por em): altura de mayúscula y alto real de mayúsculas CON tilde/ñ.
const TEKO_CAP = 0.622;
const TEKO_ACCENT = 0.78;
const BAR_W = 416;     // ancho de la barra de título (x54..470, roja y verde)
const BAR_MARGIN = 12; // aire a cada lado del texto

// Tamaño máximo para que el título quepa a lo ANCHO de la barra (centrado por la
// mayúscula). Si el título trae tilde/ñ se reserva su alto extra; si no, cabe más.
function widthCapForTitle(titulo) {
  const acc = /[ÁÉÍÓÚÜÑ]/.test(titulo); // ya viene en mayúsculas
  const half = BAR_W / 2 - BAR_MARGIN;
  return acc ? half / (TEKO_ACCENT - TEKO_CAP / 2) : half / (TEKO_CAP / 2);
}

// Un <text> rotado +90 centrado en la barra por la CAJA DE MAYÚSCULA (no por el
// central de la fuente: en Teko el central descentra y saca las tildes). Baseline
// alfabético (determinista en SVG-como-img y SVG inline) + y = capHeight/2.
function rotTitle(cx, txt, size, ls, startY, fill) {
  const yOff = ((TEKO_CAP / 2) * size).toFixed(1);
  return `<g transform="translate(${cx.toFixed(1)},${startY.toFixed(1)}) rotate(90)"><text x="0" y="${yOff}" font-family="Teko" font-weight="700" font-size="${size}" letter-spacing="${ls}" fill="${fill}" text-anchor="start">${esc(txt)}</text></g>`;
}

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

  // 1 línea: tope por largo (maxLen) Y por ancho de barra (con acentos).
  const one = fitText(tekoFor, titulo, A.size, A.ls, A.maxLen);
  const size1 = Math.min(one.size, widthCapForTitle(titulo));
  if (size1 >= A.min1Line || !titulo.includes(" ")) {
    const ls1 = A.ls * (size1 / A.size);
    const len = measure(tekoFor, titulo, size1, ls1);
    return rotTitle(A.cx, titulo, size1, ls1, startYFor(len), TITULO_A_FILL);
  }
  // 2 columnas: ya son angostas (capByWidth), no requieren el tope de acento.
  const [l1, l2] = splitTwoLines(titulo);
  const f1 = fitText(tekoFor, l1, A.size, A.ls, A.maxLen);
  const f2 = fitText(tekoFor, l2, A.size, A.ls, A.maxLen);
  const capByWidth = A.maxBlockW / (1 + A.colGapFactor);
  const size = Math.min(f1.size, f2.size, capByWidth);
  const ls = A.ls * (size / A.size);
  const colGap = A.colGapFactor * size;
  const startY = startYFor(Math.max(measure(tekoFor, l1, size, ls), measure(tekoFor, l2, size, ls)));
  return (
    rotTitle(A.cx + colGap / 2, l1, size, ls, startY, TITULO_A_FILL) +
    rotTitle(A.cx - colGap / 2, l2, size, ls, startY, TITULO_A_FILL)
  );
}

// SVG interior AMARILLA/ROJA (sin píldora; flavor = frase word-wrap centrada vertical).
function svgAmarilla(texto, flavor) {
  const titulo = String(texto).toUpperCase();
  const t = amarillaTitle(titulo);
  const fl = wrapFit(mont600For, flavor || "", FLAVOR_A);
  const totalH = fl.lines.length * fl.gap;
  const startBaseline = FLAVOR_A.boxTop + (FLAVOR_A.boxH - totalH) / 2 + fl.size * 0.78;
  const lines = fl.lines
    .map((s, i) =>
      `<text x="${FLAVOR_A.rightX}" y="${startBaseline + i * fl.gap}" font-family="Montserrat" font-style="italic" font-weight="600" font-size="${fl.size}" fill="#fff" text-anchor="end">${esc(s)}</text>`
    )
    .join("");
  return t + lines;
}

// SVG interior VERDE (píldora con la palabra calada + flavor 2 sinónimos, derecha).
function svgVerde(texto, sinonimos) {
  const titulo = String(texto).toUpperCase();
  const tFit = fitText(tekoFor, titulo, TITULO.size, TITULO.ls, TITULO.maxLen);
  const tSize = Math.min(tFit.size, widthCapForTitle(titulo)); // tope por ancho de barra
  const tLs = TITULO.ls * (tSize / TITULO.size);
  const pFit = fitText(tekoFor, titulo, PILDORA.size, PILDORA.ls, PILDORA.maxW - PILDORA.padX * 2);
  const wordW = measure(tekoFor, titulo, pFit.size, pFit.ls);
  const pillW = wordW + PILDORA.padX * 2;
  const pillX = PILDORA.rightX - pillW;
  const pillY = PILDORA.cy - PILDORA.h / 2;
  const rx = PILDORA.h / 2;
  const flavorLines = (sinonimos || [])
    .map((s, i) => {
      const fFit = fitText(mont600For, s, FLAVOR.size, 0, FLAVOR.maxW);
      return `<text x="${FLAVOR.rightX}" y="${FLAVOR.baseline1 + i * FLAVOR.gap}" font-family="Montserrat" font-style="italic" font-weight="600" font-size="${fFit.size}" fill="#fff" text-anchor="end">${esc(s)}</text>`;
    })
    .join("");
  return (
    `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${PILDORA.h}" rx="${rx}" ry="${rx}" fill="#fff"/>` +
    `<text x="${PILDORA.rightX - PILDORA.padX}" y="${PILDORA.cy + PILDORA.textDy}" font-family="Teko" font-weight="700" font-size="${pFit.size}" letter-spacing="${pFit.ls}" fill="${BG_VERDE}" text-anchor="end" dominant-baseline="central">${esc(titulo)}</text>` +
    rotTitle(TITULO.cx, titulo, tSize, tLs, TITULO.topY, "#fff") +
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
// Tolerante al apóstrofe de jerga: algunas verdes son canónicas con ' final
// (Camburao'), pero ciertos datos las traen sin él (Camburao) → probamos ambas.
export function poseFor(color, texto) {
  const map = POSES[color] || {};
  const t = String(texto).trim();
  return map[texto] || map[t] || map[t + "'"] || map[t.replace(/'+$/, "")] || "";
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
