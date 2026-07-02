# ROADMAP — Mamones con Mamones

Ideas y mejoras pendientes para el juego. Documento vivo. Ver `HANDOFF.md` para el
estado actual y la arquitectura.

**Regla clave:** todo cambio de juego (gráficas, animaciones, lógica de cartas) va
**tanto a single-player (Phaser, `src/game/`) como a multiplayer (React + Supabase,
`src/ui/OnlineGame.jsx` + RPCs en `supabase/migrations/`)**. Marcamos `[MP]` lo que
solo aplica al online.

Leyenda de esfuerzo/impacto: 🟢 bajo · 🟡 medio · 🔴 alto.

---

## ✅ Hecho
- [x] **Pantalla "Cómo jugar"** — modal con reglas + los 6 efectos de la ruleta (`src/ui/ComoJugar.jsx`).
- [x] **Optimizar imágenes** — `scripts/optimize-assets.mjs` (sharp): 3.9MB → 639KB (**-83%**).
- [x] **Logo del juego en el home** (en vez del título de texto); + favicon, splash y reverso de cartas.
- [x] **Sección "Acerca de / Nuestro Equipo"** (`src/ui/AcercaDe.jsx`), con enlace a x.com/sergebruni.
- [x] **Single-player responsive en móvil** (retrato: marcador en chips, sin solapes con la carta verde).
- [x] **Chat de texto en la sala** `[MP]` — bottom-sheet con Realtime **broadcast** (efímero, sin tabla). Botón 💬 con badge de no leídos.
- [x] **Reacciones / emotes** `[MP]` — 👏😂🤢🔥❤️ sobre cada carta jugada, flotan para todos (broadcast).
- [x] **Recap de fin de partida** (SP + MP) — overlay compartido `src/ui/Recap.jsx`: campeón, **podio** (rondas ganadas) y **repaso ronda a ronda** (verde → roja ganadora → quién). MP persiste `salas.historial` (migración `0019`); SP lo emite desde Phaser (`mcm:gameover`). *(Nota: no hay "carta más votada" porque el Juez elige y las reacciones son efímeras.)*
- [x] **Scroll en pantallas largas (móvil)** — el lobby/menú ya no recortan arriba: `overflow-y:auto` + panel centrado con `margin:auto`.
- [x] **Fixes Ruleta del Mamón Amargo (MP)** — giraba solo en escritorio (fix con doble `rAF`), "pasa el mamón" ahora re-gira para el nuevo objetivo, el efecto no se pierde si el objetivo es Juez la ronda siguiente (`0020`), y "pela el ojo" re-oculta la carta anterior. El SP ya estaba bien.
- [x] **Panel admin de cartas + auth con roles** — `/?admin` (`src/ui/Admin.jsx`): login correo+clave/Google, rol `admin` (`user_roles` + `is_admin`, RLS de escritura solo admin, `0021`), CRUD de cartas + import/export CSV. Sienta la base de "Cuentas reales".

## Profundidad de juego (SP + MP)
- [ ] **Carta en blanco** — el jugador escribe su propia roja esa ronda (estilo Cards Against Humanity). Gran rejugabilidad. Esfuerzo 🟡 · Impacto 🔴
- [ ] **Filtro de categorías** — elegir/excluir mazos por la columna `tipo` (solo Personajes, sin política, etc.) desde el lobby/menú. Esfuerzo 🟡 · Impacto 🟡
- [ ] **Bots más listos (SP)** — hoy juegan y juzgan al azar; darles "personalidad" (preferir cierto `tipo`, elegir por rareza/longitud). Esfuerzo 🟡 · Impacto 🟡
- [ ] **Más modos**: por equipos, doble juez, rondas relámpago. Esfuerzo 🟡 · Impacto 🟡
- [ ] **Mecánicas de remontada** (catch-up) para que no se decida temprano. Esfuerzo 🟡 · Impacto 🟢
- [ ] **Más efectos de ruleta / pool configurable** del Mamón Amargo. Esfuerzo 🟡 · Impacto 🟢

## Social / retención `[MP]`
- [ ] **Cuentas reales** (hoy login anónimo) → perfiles, avatar, estadísticas e historial. Desbloquea casi todo lo de abajo. Esfuerzo 🔴 · Impacto 🔴 · *(Ya existe la base de auth: correo+clave/Google + roles del panel admin; falta llevar cuentas a los jugadores + perfiles/stats.)*
- [ ] **Amigos / revancha con el mismo grupo**, salas con nombre. Esfuerzo 🟡 · Impacto 🟡
- [ ] **Leaderboards y logros.** Esfuerzo 🟡 · Impacto 🟡
- [ ] **Modo espectador** para quien llega tarde. Esfuerzo 🟡 · Impacto 🟢
- [ ] **Notificaciones** locales ("es tu turno / eres Juez") y **Web Push** (app cerrada; VAPID + tabla suscripciones + Edge Function + PWA en iOS). Esfuerzo 🟡–🔴 · Impacto 🟡
- [ ] **Chat de voz** — la feature más compleja. Ventaja: Realtime sirve de señalización WebRTC. Difícil: TURN/NAT, iOS, escala de la malla (SFU a 8–10). Prototipo: malla + push-to-talk + STUN. Esfuerzo 🔴 · Impacto 🟡

## Contenido / administración
- [ ] **Gestión de roles del equipo desde el panel** — hoy `admin` se concede por SQL; falta UI en `/?admin` para invitar/asignar roles (el enum ya tiene `moderator`). Habilita la moderación de las cartas de la comunidad. Esfuerzo 🟡 · Impacto 🟢
- [ ] **Packs / expansiones** (regionales: zuliano, oriental…; temporales: navidad, elecciones). El panel admin + `tipo` ya facilitan curarlos. Esfuerzo 🟡 · Impacto 🟡
- [ ] **Cartas de la comunidad** (envío + moderación con el rol `moderator`). Esfuerzo 🔴 · Impacto 🟡
- [ ] **Curar el mazo** con datos de qué cartas ganan más (requiere analytics; el panel admin ya permite activar/desactivar). Esfuerzo 🟢 · Impacto 🟡

## Plataforma / distribución
- [ ] **App para tiendas (iOS/Android) — recomendado: Capacitor.** Envuelve el build web (`dist/`) en un WebView nativo reutilizando el **100% del código** (React DOM **y** Phaser corren igual dentro del WebView). Da App Store/Play + **push/haptics nativos**; ya hay manifest/íconos/splash. Pendientes: *safe-areas* del notch (CSS `env(safe-area-inset-*)`), deep links para invitaciones (`?sala=`), cuenta Apple ($99/año) + Play ($25 único). Se puede scaffold en el repo (`ios/`+`android/`, `capacitor.config`). Esfuerzo 🟡 · Impacto 🟡
  - **React Native NO recomendado aquí:** exigiría reescribir toda la UI (RN no usa DOM/CSS) y **Phaser no corre en RN** (el single-player quedaría en WebView de todas formas). Solo Supabase portaría directo.
  - La **PWA actual ya es instalable** (opción $0, con límites en iOS).
- [ ] **Marca en el login de Google** — en la pantalla de consentimiento (Google Cloud) poner **nombre "Mamones con Mamones" + logo** y publicar la app (scopes no-sensibles → sin revisión). Hoy el consentimiento muestra el dominio de Supabase, lo que resta confianza. Esfuerzo 🟢 · Impacto 🟢
- [ ] **Dominio propio en el auth (whitelabel)** — add-on **Custom Domain** de Supabase (💲 ~$10/mes) para que el OAuth y las URLs muestren tu dominio en vez de `*.supabase.co`. Solo cambia `VITE_SUPABASE_URL`. Esfuerzo 🟢 · Impacto 🟢

## Salud técnica
- [ ] **Analytics (PostHog)** — instrumentar: dónde abandonan, qué efectos gustan, qué cartas ganan más. Guía todo lo demás. Esfuerzo 🟢 · Impacto 🟡
- [ ] **Code-splitting de Phaser** — el bundle son ~1.9MB y los jugadores de solo-online cargan Phaser sin usarlo. Esfuerzo 🟡 · Impacto 🟡
- [ ] **Tests** — no hay ninguno; unos pocos sobre las funciones SQL (descarte/no-repetición/piensa rápido) evitarían regresiones. Esfuerzo 🟡 · Impacto 🟡
- [ ] **Anti-trampa de presencia** — un solo "coordinador" reporta conectados. Esfuerzo 🟡 · Impacto 🟢
- [ ] **SP 7–8 jugadores** — hoy el single-player permite 4–6 (espacio en pantalla); las metas 5/4 son solo del online. Esfuerzo 🟡 · Impacto 🟢
- [ ] **Nitidez hi-DPI en single-player** — el canvas de Phaser renderiza a resolución CSS (Scale.RESIZE), así que en móviles retina el texto/cartas se ven más suaves que el online (DOM). Fix: renderizar a `devicePixelRatio` (reescalar los topes de `computeLayout`). Esfuerzo 🟡 · Impacto 🟡

---

## Orden sugerido
1. **Analytics (PostHog)** 🟢 — para decidir el resto con datos (dónde abandonan, qué efectos/cartas gustan).
2. **Carta en blanco** o **filtro de categorías** — la mejora de juego con más retorno (el panel admin ya facilita curar categorías).
3. **Marca del login de Google** 🟢 — rápido; sube la confianza en el acceso.
4. Salto grande: **cuentas para jugadores + stats** (ya está la base de auth/roles del panel admin) → habilita amigos, leaderboards y notificaciones.
