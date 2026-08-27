# Migración a Cloudflare — plan detallado

> **Estado (2026-08-27):** Fase 0 ✅ · Fase 1 ✅ (motor en `src/rules/`, 64 tests) · Fase 2 ✅ (Worker `server/index.ts` + `SalaDO` con hibernation/alarms, 15 tests en workerd; identidad aún por stub `x-mcm-uid`) · **siguiente: Fase 3 (Better Auth + D1)**.

Objetivo: **descartar Supabase por completo** y mover el multijugador a **Cloudflare Workers + Durable Objects + D1**, en la misma cuenta/worker donde ya se despliega el front. Documento de trabajo para ejecutar la migración por fases; cada fase deja el repo en estado consistente.

**Referencia clave: `~/projects/distrito-game`** — mismo autor, mismo género (juego de cartas multijugador por rondas), **ya migrado de Supabase a esta misma arquitectura**. Gran parte del esqueleto se copia de ahí (rutas exactas en §7).

---

## 1. Decisiones de arquitectura

| Decisión | Elección | Por qué |
|---|---|---|
| Sala de juego | **1 Durable Object por sala** (clase `SalaDO`, direccionada por `getByName(codigo)`) | Estado autoritativo single-threaded: el `for update` de `resolver_timeout`, RLS y toda la coordinación anti-carrera desaparecen. |
| Tiempo real | **WebSocket Hibernation API** del DO | Reemplaza Realtime (presence + postgres_changes) **y** el polling de 3 s. El DO empuja snapshots; el cliente no vuelve a hacer fetch. |
| Timeouts | **Alarms del DO** (`storage.setAlarm(faseHasta)`) | El servidor resuelve los deadlines solo. Hoy, sin clientes conectados haciendo polling, la sala se congela — eso se elimina de raíz. |
| Estado de sala | **`storage.put` de UN objeto** (clave única `sala`), clase declarada con `new_sqlite_classes` | Patrón probado en distrito-game: toda escritura es atómica, `load()`/`persist()` triviales. El estado por sala es pequeño (≤10 jugadores). No usamos `sql.exec` del DO. |
| Datos globales | **D1** (`mamones-db`): tablas de Better Auth, `user_roles`, `cartas` | Lo único que cruza salas. El bucle de ronda **nunca** toca D1 (regla del canon de distrito): el DO lee el mazo una vez al iniciar partida y escribe historial/estadísticas solo al terminar, en try/catch. |
| Mazo (runtime MP) | **D1 `cartas`**, snapshot al DO en `iniciar_partida` | Preserva el panel admin (edición en vivo). El SP sigue con `src/game/data/cartas.json` empaquetado (PWA offline). El drift SP/MP solo afecta partidas nuevas y ambas fuentes salen del mismo generador. |
| Auth | **Better Auth sobre D1**, plugins `anonymous()` + Google | Reemplazo directo de Supabase Auth con el mismo modelo de hoy: jugadores anónimos + login real (Google/email) para el panel admin. Ya resuelto en distrito (`auth.ts`, `session.ts`). |
| Confianza DO | El Worker resuelve la sesión y estampa **`X-User-Id`** en lo que reenvía al DO; el DO no confía en nada más | Es el equivalente funcional del RLS. Copiar `session.ts` de distrito casi tal cual. |
| Lenguaje | Server (`server/`) en **TypeScript** (los archivos copiados de distrito ya lo son; wrangler lo compila sin config). Motor de reglas (`src/rules/`) en **JS + JSDoc**, importable por el DO (TS importa JS) y por Phaser sin tocar el build del front | Mínima fricción en ambas direcciones. |
| Reglas del juego | **Módulo puro compartido `src/rules/`** con RNG sembrable | La razón estratégica de la migración: hoy las reglas viven 2 veces (SQL para MP, JS/Phaser para SP). Con el motor en JS, la paridad SP/MP pasa de disciplina a estructura. |
| Repo | Se mantiene **un solo package** (sin workspaces) | El monorepo de distrito no paga su costo aquí; `server/` y `src/` conviven y wrangler bundlea el server por separado de Vite. |
| Deploy | El **mismo worker** `mamones-con-mamones` gana `main` + bindings; assets siguen igual con `run_worker_first: ["/api/*", "/salas/*"]`. CI por **GitHub Actions** (copiada de distrito) con `d1 migrations apply` antes de `wrangler deploy`, + worker gemelo `env.staging` | Un artefacto, un deploy, staging real para playtest antes del corte. |

**Qué NO cambia:** el single-player Phaser, toda la UI/CSS/brandkit, la PWA, el flujo de autoría de cartas (Sheets → CSV → `gen-cartas.mjs`), el flujo Recap/chat/reacciones tal como los ve el usuario.

---

## 2. Mapa de reemplazos

| Hoy (Supabase) | Después (Cloudflare) |
|---|---|
| 26 funciones SQL `SECURITY DEFINER` | Motor `src/rules/` + métodos del `SalaDO` |
| Tablas `salas`, `jugadores_sala`, `cartas_mano`, `mesa_juego` | Un objeto `sala` en el storage del DO |
| Tabla `cartas` + RLS admin | D1 `cartas` + endpoints `/api/admin/*` gateados por rol |
| `user_roles`, `has_role`, `is_admin` | D1 `user_roles` + chequeo en el Worker |
| Supabase Auth (anónimo + email/Google) | Better Auth en el Worker (anónimo + Google), sesión → `X-User-Id` |
| Realtime presence + `marcar_conectados` | Ciclo de vida real de los WebSockets (`webSocketClose`/reconexión) — de paso se cierra el hueco anti-trampa (hoy cualquier cliente marca conectados a toda la sala) |
| `postgres_changes` (4 tablas) + polling 3 s + 6 fetches (`sala/players/mano/mesa/jugaron/misJugadas`) | **Un snapshot por jugador** empujado por WS tras cada mutación |
| `resolver_timeout` invocado por clientes cada 3 s | `alarm()` del DO |
| Trigger `tg_salas_fase_hasta` | Función `transicionar(fase)` con `{jugando: 60, juzgando: 45, resultado: 25}` s |
| `mesa_actual` + políticas RLS de censura | Serializador de vista por jugador (`vista.js`) — **el punto de mayor riesgo funcional del port** |
| Broadcast Realtime (chat, reacciones) | Broadcast WS del DO (mismos payloads) |
| Migraciones a mano en el SQL Editor | `wrangler d1 migrations apply` en CI (el estado de sala no migra: vive en el DO y es efímero) |

---

## 3. Protocolo cliente ↔ servidor

**HTTP (Worker):**
- `POST /api/salas` → crea sala: genera código (alfabeto sin O/0/I/1/L), RPC `crear` al DO; si el DO ya existía, reintenta con otro código.
- `POST /api/salas/:codigo/join` → RPC `unirse` (valida fase lobby, cupo, reconexión).
- `GET /salas/:codigo/ws` → upgrade WebSocket (el Worker estampa `X-User-Id`).
- `/api/auth/*` → Better Auth. `/api/admin/cartas*` → CRUD + import/export CSV (solo admin).

**WS cliente → DO** (mapa 1:1 con las RPC que sobreviven): `set_config`, `iniciar`, `jugar_carta`, `elegir_ganadora`, `elegir_peor`, `pasar_mamon`, `siguiente_ronda`, `reiniciar`, `abandonar`, `chat`, `reaccion`.
**Desaparecen** (pasan a ser server-side o parte del snapshot): `marcar_conectados`, `resolver_timeout`, `mesa_actual`, `jugaron_uids`, `meta_ganar`, `reparar_sala`.

**WS DO → cliente:**
- `snapshot` — estado completo **censurado por uid** `{sala, jugadores, mesa, jugaron, misJugadas, mano, meta}`, con la misma forma que hoy montan los 6 fetches de `OnlineGame.jsx` (minimiza el refactor del cliente). Se envía al conectar y tras cada mutación.
- `chat` / `reaccion` — efímeros, broadcast sin persistir (igual que hoy).
- `error` — validaciones rechazadas, con el mensaje que hoy lanza el `raise exception`.

Los tipos del protocolo viven en `src/net/protocol.js`, compartidos por cliente y server (patrón `packages/protocol` de distrito; evita el drift que hoy cubren los tipos de Supabase).

---

## 4. Fases

### Fase 0 — Preparación (½ sesión)
1. **Merge PR #2** (mazo 1047 unificado) — el JSON unificado es la fuente del mazo del backend nuevo. *(Correr `0022` en Supabase es opcional y solo cosmético: le daría el mazo nuevo al MP en vivo durante la transición; el seed de D1 no depende de Supabase. Si la migración arranca ya, saltárselo.)*
2. **Congelar Supabase**: no más migraciones nuevas; `supabase/` queda como referencia hasta la Fase 7.
3. `bun add -d wrangler vitest @cloudflare/vitest-pool-workers` + script `test`.

### Fase 1 — Motor de reglas `src/rules/` (la fase grande: 2–3 sesiones)
Port de la lógica SQL a funciones puras `(estado, accion, ctx) → estado'` sin I/O, con RNG sembrable (`makeRng`/`mixSeed` de distrito) y reloj inyectado (`ctx.now`) para que todo sea determinista y testeable **sin infraestructura**.

Distribución (fuente de verdad del comportamiento: el inventario SQL — ver §6 y `HANDOFF.md`):

| Módulo | Absorbe (SQL) | Complejidad |
|---|---|---|
| `estado.js` | forma del estado de sala + `transicionar(fase)` (ex-trigger) + validaciones comunes | baja |
| `sala.js` | `unirse_sala`, `abandonar_sala`, `reparar_sala`, conectividad | media |
| `partida.js` | `iniciar_partida`, `reiniciar_partida`, `meta_ganar`, `cartas_para_ganar` | media |
| `mazos.js` | `repartir_mano` (mano de 7, top-up, exclusión manos∪mesa∪descarte, reciclaje), `nueva_verde` | media |
| `ronda.js` | `jugar_carta`, `cerrar_jugadas` (Piensa Rápido: ≥2 jugadores, umbral 5 s, el último recupera), `avanzar_ronda`, `resolver_timeout` | **alta** |
| `juicio.js` | `elegir_ganadora` (bifurcación meta/amarga/clásica + historial), `elegir_peor` | alta |
| `ruleta.js` | `girar_ruleta_para` (rejection sampling: sin 🥶 si no hay Piensa Rápido, sin 🤢 en re-giro), `pasar_mamon`, aplicación de los 6 efectos, `sin_turno` | media |
| `vista.js` | `mesa_actual` + toda la censura RLS: mano solo propia, mesa anónima en `juzgando` (orden estable por hash), autores solo en `resultado`/`terminado` | media, **riesgo alto** |

**Tests Vitest por módulo** — como mínimo: ciclo de ronda completo en clásica y amarga; los 6 efectos (incluido conservar el efecto pendiente si el objetivo pasa a ser juez, fix 0020); Piensa Rápido con la excepción <5 s; timeout en cada fase (0 jugadas → salta ronda, 1 → gana sola + historial, ≥2 → a juzgar **sin** penalización PR); descarte sin repetición + reciclaje al agotar el mazo; rotación de juez saltando desconectados; migración de host; metas automáticas 4→8 … 8-10→4.

**Decisiones de port** (comportamientos hoy defectuosos — corregirlos aquí, cada uno es trivial en JS, y quedan documentados):
1. Cupo por `max(orden)+1` sin reutilizar → contar jugadores presentes; `orden` deja de gobernar el aforo.
2. `cerrar_jugadas`/`reparar_sala` cuentan jugadas de desconectados o ignoran `cartas_a_jugar` (cierre prematuro con jugada doble) → un solo cálculo `esperadas()` correcto y compartido.
3. `meta_ganar` se re-evalúa con el nº de jugadores vivo (victorias retroactivas si alguien abandona) → **congelar la meta en `iniciar_partida`**.
4. `abandonar_sala` devuelve las cartas del que se va al pool en vez del descarte → volcarlas a `mazo_rojo` (consistencia).

**No portar**: el auto-juego por timeout (existió en 0007-0009, eliminado en 0012 — el `resolver_timeout` vigente es el de 0019).

### Fase 2 — Worker + `SalaDO` (1–2 sesiones)
1. `wrangler.jsonc`: `main: server/index.ts`, binding `SALA` → `SalaDO` con `new_sqlite_classes`, assets con `run_worker_first`, `nodejs_compat`, `observability`, y `env.staging` con bindings redeclarados (plantilla: wrangler de distrito).
2. `server/index.ts` — router copiado de distrito (103 líneas): regex de ruta, `env.SALA.getByName(codigo)`, gate de sesión, RPC tipada al DO (RPC nativa, no `fetch` interno; gotcha: `ctx.id.name` no es fiable — pasar el código explícito).
3. `server/SalaDO.ts` — cascarón fino sobre `src/rules/`:
   - `load()`/`persist()` con clave única; todo handler empieza con `await this.load()` (nada en memoria sobrevive la hibernación).
   - Upgrade WS: `acceptWebSocket(server, [uid])` + `serializeAttachment({uid})` + snapshot inmediato al conectar (la reconexión es gratis: reconectar ⇒ re-sincronizar).
   - `webSocketMessage`: parse → `rules.aplicar(estado, accion)` → `persist()` → broadcast de snapshots por-uid (`getWebSockets()` con try/catch por socket).
   - `alarm()`: ejecuta `resolver_timeout` con el reloj del servidor. Una sola alarm activa = `faseHasta` vigente; `transicionar()` la re-arma, `terminado`/`lobby` la cancela (`deleteAlarm`).
   - `webSocketClose`: marca desconexión + `reparar_sala` (migración de host, juez caído recupera cartas, desbloqueos). Opcional: gracia de ~5 s vía alarm para no penalizar parpadeos de red móvil.
   - Sala vacía (último `abandonar`): `storage.deleteAll()` + `deleteAlarm` (hoy: `delete from salas` cascade). Backstop: alarm de TTL para salas zombie en lobby.
   - *Seams* RPC para tests sin sockets (patrón `confirmRpc`/`snapshotRpc` de distrito).
4. Tests con `@cloudflare/vitest-pool-workers`: DO por RPC + `runDurableObjectAlarm` para los timeouts (plantilla `room.test.ts` de distrito; incluye el workaround `pretest` que crea `dist/` — wrangler exige que exista `assets.directory`).

### Fase 3 — Auth + D1 (1 sesión, mayormente copiado)
1. Crear `mamones-db` (+ staging). Migraciones D1 en `server/migrations/`: esquema Better Auth (generado con el script de distrito), `user_roles`, `cartas (id, color check in ('verde','roja'), tipo, texto, flavor, activa, unique(color,texto))` — traducción Postgres→SQLite ya resuelta en las migraciones de distrito (`unixepoch()`, `CHECK` en vez de enums).
2. `server/auth.ts` (Better Auth + `anonymous()` + Google + `bearer()`, caché por isolate, `baseURL` del origin — sin eso emite cookies sin `Secure`) y `server/session.ts` (`X-User-Id`) — copiar de distrito.
3. Secrets: `wrangler secret put BETTER_AUTH_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET`. Google OAuth: nuevas redirect URIs (workers.dev + localhost).
4. `gen-cartas.mjs` gana un tercer output: `server/migrations/00XX_seed_cartas.sql` (upsert idempotente, mismo dedupe). Seed inicial a D1.

### Fase 4 — Cliente (1–2 sesiones)
1. `src/net/salaClient.js` — adaptar `matchClient.ts` de distrito (reconexión con backoff, `closedOnPurpose`) **añadiendo lo que distrito no tiene**: heartbeat ping/pong y cola de acciones pendientes mientras el socket no está `OPEN` (en un juego por turnos un `jugar_carta` no puede descartarse en silencio).
2. `src/net/api.js` — puerta HTTP con `credentials: "include"` y la regla del 401 → volver al login (48 líneas de distrito).
3. `src/lib/supabase.js` → `src/lib/auth.js`: `ensureAuth()` pasa a `authClient.signIn.anonymous()` (Better Auth conserva la firma conceptual: "garantiza sesión, devuelve user").
4. `Lobby.jsx`: crear/unirse por `api.js`; presencia desde el snapshot (campo `conectado`). Se conservan tal cual: reconexión `mcm_room`, deep-link `?sala=`, compartir.
5. `OnlineGame.jsx` — el refactor mayor pero mecánico: fuera canal Supabase, los 6 fetches, el polling de 3 s y el disparo de `resolver_timeout`; entra `salaClient.onSnapshot(setEstado)` + `enviar(accion)`. Chat/reacciones por el mismo WS. Todo el render, la ruleta, animaciones y Recap quedan intactos (el snapshot replica la forma actual del estado).
6. `Admin.jsx`: login Better Auth (Google/email) + fetch a `/api/admin/cartas`; el CRUD, filtros y CSV import/export se conservan (cambia el transporte, no la pantalla).

### Fase 5 — CI, staging y playtest (1 sesión)
1. Workflows de distrito: `ci.yml` (PRs: lint + test) y `deploy.yml` (push a master: test → `d1 migrations apply --remote` → build front → `wrangler deploy`; si la migración falla no se despliega). Secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. **Desactivar el auto-deploy actual de Workers Builds** para no tener dos deployers.
2. Deploy a `env.staging` y playtest real: 4+ teléfonos, partida completa en clásica y amarga, con Piensa Rápido, con caídas de red a mitad de ronda (matar la app, cambiar de WiFi a datos), juez desconectado, revancha.
3. Criterio de corte: una partida completa sin tocar el código y sin estados colgados.

### Fase 6 — Corte (½ sesión)
1. Deploy a producción. **No hay migración de datos**: las salas son efímeras y el mazo ya está en D1/git. Se pierden (aceptado): cuentas admin de Supabase (re-registro + re-bootstrap del primer admin vía SQL en D1) y nada más.
2. **Gotcha PWA**: el SW cachea el bundle viejo (que habla con Supabase). Mantener el proyecto Supabase **vivo pero intocado ~1 semana** para los clientes rezagados; el autoUpdate del SW los va trayendo.
3. Bootstrap admin: `INSERT INTO user_roles (user_id, role) ...` vía `wrangler d1 execute`.

### Fase 7 — Demolición (½ sesión, tras la semana de gracia)
1. `bun remove @supabase/supabase-js`; borrar `src/lib/supabase.js`, `supabase/` (queda en la historia de git), `VITE_SUPABASE_*` de `.env*`.
2. Pausar y luego **borrar el proyecto Supabase** `hmptndzxaaoghmioeokc` (irreversible — verificar antes que no queda nada: las cartas viven en CSV/git + D1).
3. Actualizar `HANDOFF.md` (secciones Infra, Arquitectura multijugador, Migraciones → D1) y `ROADMAP.md`. Los pendientes del roadmap mejoran de precio: **Web Push** ya no necesita Edge Function (worker + D1 para suscripciones); la **señalización WebRTC** del chat de voz usa el broadcast del DO igual que usaba Realtime.

### Fase 8 (opcional, post-migración) — Paridad SP por construcción
`GameScene.js` adopta `src/rules/` (los bots juegan `acciones` contra el mismo motor). A partir de ahí una regla nueva se escribe una sola vez. No bloquea nada de lo anterior; es el dividendo a cobrar cuando toque la próxima feature de juego.

---

## 5. Riesgos principales

| Riesgo | Mitigación |
|---|---|
| **Serializador de vista** (censura por fase/rol): un error filtra cartas ajenas al juez o rompe el anonimato de la mesa | Tests dedicados en `vista.js` por cada (fase × rol); es la única pieza sin equivalente 1:1 en distrito |
| Estado tras hibernación (nada en memoria sobrevive) | Disciplina `load()` al inicio de **todo** handler + attachment por socket (patrón calcado de distrito) |
| Doble juicio Amargo comparte el deadline de `juzgando` (45 s para mejor **y** peor, sin refresco — comportamiento actual) | Portar fiel primero; si el playtest lo pide, refrescar el deadline al elegir la mejor es un cambio de una línea en `transicionar` |
| WS en iOS/PWA en background (sockets muertos a medias) | Heartbeat + resync por snapshot al `visibilitychange`; la reconexión ya trae el estado completo |
| Better Auth: cookies sin `Secure` detrás de https | `baseURL` desde el origin de la request (bug ya cazado y resuelto en distrito) |
| Dos sistemas de deploy compitiendo durante la transición | Fase 5.1: apagar Workers Builds al activar Actions |
| `bun run test` revienta en clone limpio (wrangler exige `assets.directory`) | `pretest` que hace `mkdir -p dist` (workaround documentado en distrito) |

## 6. Fuentes de verdad para ejecutar

- **Comportamiento exacto de cada función SQL** (firmas, ramas, deadlines, efectos, invariantes y bugs conocidos): inventario levantado el 2026-08-27 — sesión de este plan. Lo esencial está condensado en §4-Fase 1; ante cualquier duda el SQL vigente es: última redefinición de cada función (`resolver_timeout`/`elegir_ganadora`/`iniciar_partida`/`meta_ganar` → 0019, `avanzar_ronda`/`pasar_mamon` → 0020, `girar_ruleta_para`/`repartir_mano` → 0018, `cerrar_jugadas`/`siguiente_ronda` → 0016, `mesa_actual` → 0011, resto ver git).
- **Reglas de juego en prosa**: `HANDOFF.md` §"Reglas del juego" y §"Arquitectura multijugador".

## 7. Qué copiar de `~/projects/distrito-game` (orden de valor)

| Archivo | Uso aquí |
|---|---|
| `apps/server/wrangler.jsonc` | Plantilla completa (DO + D1 + assets + staging) |
| `apps/server/src/session.ts` | Casi tal cual — el reemplazo del RLS |
| `apps/server/src/auth.ts` | Better Auth + D1 + CORS credentialed |
| `apps/server/src/index.ts` | Esqueleto del router Worker→DO |
| `apps/server/src/room.ts:303-436` | Bloque hibernation + alarms (adaptar lógica, conservar la forma) |
| `apps/client/src/net/{api,matchClient}.ts` | Puerta HTTP + cliente WS (añadir heartbeat/cola) |
| `apps/client/src/auth/client.ts` | Cliente Better Auth (24 líneas) |
| `packages/protocol/src/index.ts` | Patrón de protocolo compartido |
| `apps/server/{vitest.config.ts, test/apply-migrations.ts, test/room.test.ts}` | Testing de DO + D1 + alarms |
| `.github/workflows/{ci,deploy}.yml` | Pipeline bun + wrangler |
| `apps/server/migrations/0001-0003_*.sql` | Traducción Postgres→SQLite de referencia |
| `apps/server/scripts/generate-auth-schema.ts` | Regenerar esquema Better Auth |

## 8. Estimación

| Fase | Sesiones |
|---|---|
| 0 Preparación | ½ |
| 1 Motor de reglas + tests | 2–3 |
| 2 Worker + DO | 1–2 |
| 3 Auth + D1 | 1 |
| 4 Cliente | 1–2 |
| 5 CI + staging + playtest | 1 |
| 6–7 Corte + demolición | 1 |
| **Total** | **~7–10 sesiones** |

La Fase 1 es la inversión; todo lo demás es mayormente copiado o mecánico. El orden 1→2→3→4 permite validar las reglas con tests puros antes de tocar infraestructura, y la infraestructura con tests de DO antes de tocar el cliente.
