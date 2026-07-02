# BRAND KIT & DESIGN SPECS — Mamones con Mamones

Identidad visual y especificaciones de diseño del juego. Sirve para dos cosas:
1. **Brand kit** para herramientas de IA de diseño (Stitch, Banani, v0, etc.) —
   ver el bloque listo para pegar al final.
2. **Spec de implementación** — todos los tokens salen del código real (fuente de
   verdad: `src/index.css` y `src/game/scenes/GameScene.js` → `COLORS`).

---

## 1. Marca

- **Nombre:** Mamones con Mamones. **Qué es:** versión criolla venezolana de *Apples
  to Apples* (Manzanas con Manzanas) — party game de cartas, solo vs bots o
  multijugador en línea.
- **Personalidad:** criollo, divertido, festivo, irreverente **pero con clase**
  (mesa de casino, no caricatura infantil).
- **Idioma:** español de **Venezuela** (jerga criolla en el contenido).
- **Concepto visual:** mesa de casino de **fieltro verde** con acentos **dorados**.
- **Logo:** `public/assets/logo.png` (usado en el home, splash y reverso de cartas).
  Favicon: `public/assets/favicon.png`.

## 2. Paleta de color

Tokens en `:root` (`src/index.css`) y espejados en `COLORS` (Phaser, `GameScene.js`).

| Token | Hex | Uso |
|---|---|---|
| `--felt-top` | `#1f4d2e` | Fieltro (tope del degradado) |
| `--felt-bottom` | `#10301d` | Fieltro (base del degradado) / fondo `body` |
| `--gold` | `#ffd35c` | **Acento y CTA principal** |
| `--panel` | `#0c2114` | Paneles / tarjetas / superficies |
| `--panel-border` | `#2e6b45` | Bordes de panel |
| `--text-light` | `#eaf5ec` | Texto principal |
| `--text-muted` | `#9fd6a3` | Texto secundario / tenue |
| `--dark` | `#16331f` | Texto sobre dorado, fondos oscuros |

**Fondo estándar:** `radial-gradient(circle at 50% 35%, var(--felt-top), var(--felt-bottom))`.

### Cartas
| Elemento | Valor |
|---|---|
| Carta roja — cara | `#f4ecd2` (crema) |
| Carta roja — borde/acento | `#8a1c10` / selección `#c0392b` |
| Carta verde — borde/acento | `#2e8b2e` |
| Borde de ganadora | `inset 0 0 0 3px var(--gold)` |

### Colores de la ruleta (una cuña por efecto)
`1 #ffd35c` · `2 #8a1c10` · `3 #2e8b2e` · `4 #e08a1c` · `5 #3a6ea5` · `6 #6b3fa0`
(fuente: `COLOR_EFECTO` en `src/ui/OnlineGame.jsx`).

## 3. Tipografía

- **Actual (código):** stack del sistema — `"Segoe UI", system-ui, sans-serif`.
- **Objetivo de marca (propuesta):** **Inter** — sans geométrica limpia, para dar
  identidad propia y consistencia entre dispositivos. Es lo que se pide a las
  herramientas de IA. *(Si se adopta, cargarla y cambiar el stack en `index.css`.)*
- **Pesos:** 400 (cuerpo), 600–700 (títulos/botones), 800 para acentos (marcador).
- **Escala:** títulos `clamp(22–38px)`; cuerpo 14–16px; secundario 12–13px.

## 4. Forma, sombra, espaciado

- **Radios:** cartas **10px**; chips/inputs **12–14px**; paneles/modales **18–22px**;
  pastillas y botones **999px** (rounded-full); círculos 50%.
- **Sombras:**
  - Panel/modal: `0 18px 50px rgba(0,0,0,0.45)`
  - Carta: `0 6px 14px rgba(0,0,0,0.35)`
  - Rueda ruleta: `0 10px 26px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(255,255,255,0.15)`
  - Bottom-sheet: `0 -12px 40px rgba(0,0,0,0.5)`
- **Espaciado:** múltiplos de 4/8px; padding de panel ~24–28px; gaps 8–14px.

## 5. Componentes

- **Botón CTA (primario):** relleno **dorado** (`--gold`), texto `--dark`, pastilla.
- **Botón fantasma:** transparente, borde `--panel-border`, texto claro.
- **Chips de marcador:** pastilla por jugador con puntos + estado (⚖️ Juez, ✓ jugó,
  pensando…); el propio y el del Juez resaltados.
- **Carta (ver §6).**
- **Rueda de la ruleta:** círculo con `conic-gradient` de 6 (o 5) cuñas, puntero
  dorado fijo arriba, hub central dorado.
- **Bottom-sheet (chat):** panel inferior redondeado arriba (`16px 16px 0 0`),
  con badge de no leídos en el botón 💬.
- **Modales:** centrados, `max-height: 88vh; overflow-y:auto`, fondo oscurecido.
- **Banner de estado:** texto + temporizador; en los últimos ≤5s el reloj parpadea
  en rojo (clase `--urge`).

## 6. Anatomía de las cartas

- **Verde = adjetivo** (la que juzga la ronda). **Roja = sustantivo** (las de la mano).
- Cara: título grande centrado + una **frase "flavor" en cursiva** al pie (opcional).
- **Reverso:** verde/dorado con el **logo** (para cartas anónimas / boca abajo).
- Categoría interna = columna `tipo` (personajes, dichos… libre).

## 7. La Ruleta del Mamón Amargo (modo Amargo)

| # | Emoji | Nombre | Efecto |
|---|---|---|---|
| 1 | 👀 | Pela el ojo | Mano boca abajo: espía y juega de memoria |
| 2 | 🥶 | Mano congelada | 10s sin poder jugar *(solo con Piensa Rápido)* |
| 3 | 🌪️ | Mazo barajado | ¡Mano nueva al azar! |
| 4 | ⏳ | A ciegas | Juegas sin ver el adjetivo verde |
| 5 | 🤢 | Pasa el mamón | ¡Salvado! Pásaselo a otro |
| 6 | 🃏 | Jugada doble | Juegas DOS cartas |

## 8. Movimiento (timings reales)

- **Carta al montoncito:** arco, `0.5s cubic-bezier(0.34, 0.2, 0.2, 1)`.
- **Giro de ruleta:** `2.6s cubic-bezier(0.16, 0.74, 0.2, 1)` (MP); tween equivalente en SP.
- **Pops (entradas):** 0.18–0.3s ease-out.
- **Reacciones flotando:** `1.4s ease-out`.
- **Sonido:** tic de ruleta/reloj y "ding" al revelar; beep en los últimos 5s.
- Regla: suave y con feedback; nada instantáneo brusco.

## 9. Layout / responsive

- **Mobile-first, portrait.** Uso a una mano, áreas táctiles ≥44px, respeta
  `safe-area-inset` del notch. Tema **oscuro** siempre.
- **Scroll de pantallas largas:** contenedor `overflow-y:auto` + panel centrado con
  `margin:auto` (centra si cabe, scrollea desde arriba si no). Los overlays largos
  usan `max-height:88vh; overflow-y:auto`.
- Jerarquía en el tablero: **carta verde > mano > acción**.

## 10. Voz y tono (copy)

- Español venezolano, cercano y jocoso. Ejemplos vivos: "🍋 Amargo", "🐢 Te pasaste
  de lento", "¡Dale!", "Pásaselo a…", "El Pollo (tú)".
- Botones en imperativo corto ("Crear partida", "Iniciar partida", "Jugar otra vez").
- Emojis con moderación como refuerzo, no decoración vacía.

---

## 11. Bloque para pegar en herramientas de IA

```text
App móvil (portrait), tema oscuro, español (Venezuela). Juego "Mamones con Mamones",
party game de cartas criollo (versión venezolana de Apples to Apples). Personalidad:
criollo, divertido, festivo, con clase.
Estética: mesa de casino de FIELTRO VERDE con acentos DORADOS.
Paleta: fondo #1f4d2e→#10301d (degradado radial), panel #0c2114 borde #2e6b45,
dorado (CTA/acento) #ffd35c, texto #eaf5ec / tenue #9fd6a3.
Cartas Apples-to-Apples: VERDE=adjetivo (borde #2e8b2e), ROJA=sustantivo (cara crema
#f4ecd2, borde #8a1c10), título grande + frase "flavor" en cursiva, reverso con logo.
Tipografía Inter. Radios: cartas 10px, paneles 18–22px, botones pastilla (full).
Botón CTA dorado. Táctil, respeta el notch. Legibilidad de cartas prioritaria.
```

## 12. Dónde vive en el código

- **Tokens:** `src/index.css` (`:root`) y `src/game/scenes/GameScene.js` (`const COLORS`).
- **Componentes/estilos:** `src/ui/*.css` (Menu, Lobby, OnlineGame, Recap, Admin,
  ComoJugar, AcercaDe, Splash).
- **Cartas SP:** plantillas en `public/` + `GameScene.makeRedCard` / `makeCardBack`.
- **Cartas MP:** clase `.carta` en `OnlineGame.css`.
- Regla de paridad: cambios visuales van a SP (Phaser) **y** MP (React) — ver `HANDOFF.md`.
