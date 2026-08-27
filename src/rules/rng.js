// RNG sembrable (mulberry32): mismo seed → misma partida. El motor nunca usa
// Math.random directo para que los tests y el replay sean deterministas.

export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mixSeed(a, b) {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Hash FNV-1a de un string (para el orden anónimo estable de la mesa).
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Un elemento al azar (null si el array está vacío).
export function elegirAzar(arr, rng) {
  if (!arr.length) return null;
  return arr[Math.floor(rng() * arr.length)];
}

// k elementos al azar sin repetición (Fisher-Yates parcial sobre una copia).
export function tomarAzar(arr, k, rng) {
  const copia = arr.slice();
  const n = Math.min(k, copia.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (copia.length - i));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, n);
}
