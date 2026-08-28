// Smoke test e2e contra un Worker desplegado (correr tras cada deploy):
// sesiones anónimas de Better Auth, sala + 4 jugadores por WebSocket con
// cookie, una ronda completa, catálogo desde D1, gate del admin y limpieza.
// Requiere Bun (usa su extensión de headers en el WebSocket del cliente).
// Uso: bun scripts/smoke.mjs https://mamones-con-mamones.sergebruni.workers.dev

const BASE = process.argv[2];
if (!BASE) throw new Error("falta la URL base");
const WS_BASE = BASE.replace(/^http/, "ws");

async function sesionAnonima(nombre) {
  const res = await fetch(`${BASE}/api/auth/sign-in/anonymous`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (res.status !== 200) throw new Error(`sign-in anónimo → ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { user } = await res.json();
  return { nombre, cookie, uid: user.id, snaps: [], errores: [] };
}

async function api(path, jugador, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: jugador.cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json()) };
}

function conectar(codigo, jugador) {
  // Header de cookie en el upgrade: extensión de Bun al constructor WebSocket.
  const ws = new WebSocket(`${WS_BASE}/salas/${codigo}/ws`, {
    headers: { cookie: jugador.cookie },
  });
  jugador.ws = ws;
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "snapshot") jugador.snaps.push(m);
    else if (m.t === "error") jugador.errores.push(m.mensaje);
  });
}

const ultimo = (j) => j.snaps.at(-1);

async function esperar(desc, fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout esperando: ${desc}`);
}

// 0. Catálogo público y gate admin.
const cartas = await (await fetch(`${BASE}/api/cartas`)).json();
console.log(`catálogo público: ${cartas.cartas.length} cartas activas`);
if (cartas.cartas.length !== 1047) throw new Error("catálogo != 1047");
const admin401 = (await fetch(`${BASE}/api/admin/cartas`)).status;
if (admin401 !== 401) throw new Error(`admin sin sesión → ${admin401}, esperaba 401`);

// 1. Cuatro sesiones anónimas reales.
const jugadores = [];
for (let i = 1; i <= 4; i++) jugadores.push(await sesionAnonima(`Auth ${i}`));
console.log(`sesiones anónimas: ${jugadores.map((j) => j.uid.slice(0, 8)).join(", ")}`);
const admin403 = (
  await fetch(`${BASE}/api/admin/cartas`, { headers: { cookie: jugadores[0].cookie } })
).status;
if (admin403 !== 403) throw new Error(`admin anónimo → ${admin403}, esperaba 403`);

// 2. Crear sala y unirse — identidad de la COOKIE, sin stub.
const creada = await api("/api/salas", jugadores[0], { nombre: jugadores[0].nombre });
if (!creada.ok) throw new Error(`crear: ${JSON.stringify(creada)}`);
const codigo = creada.codigo;
console.log(`sala ${codigo} creada con sesión de Better Auth`);
for (const j of jugadores.slice(1)) {
  const r = await api(`/api/salas/${codigo}/join`, j, { nombre: j.nombre });
  if (!r.ok) throw new Error(`join ${j.nombre}: ${JSON.stringify(r)}`);
}

// 3. WebSocket con cookie en el upgrade + una ronda completa.
for (const j of jugadores) conectar(codigo, j);
await esperar("snapshots de lobby", () => jugadores.every((j) => ultimo(j)));
jugadores[0].ws.send(JSON.stringify({ t: "iniciar" }));
await esperar("jugando", () => jugadores.every((j) => ultimo(j)?.sala.fase === "jugando"));
const juezUid = ultimo(jugadores[0]).sala.juezUid;
console.log(`ronda 1: verde="${ultimo(jugadores[0]).sala.cartaVerde}" (mazo desde D1)`);
for (const j of jugadores) {
  if (j.uid === juezUid) continue;
  j.ws.send(JSON.stringify({ t: "jugar_carta", carta: ultimo(j).mano[0] }));
}
await esperar("juzgando", () => jugadores.every((j) => ultimo(j)?.sala.fase === "juzgando"));
const juez = jugadores.find((j) => j.uid === juezUid);
juez.ws.send(JSON.stringify({ t: "elegir_ganadora", mesaId: ultimo(juez).mesa[0].id }));
await esperar("resultado", () => jugadores.every((j) => ultimo(j)?.sala.fase === "resultado"));
const ganadora = ultimo(jugadores[0]).mesa.find((m) => m.esGanadora);
console.log(`resultado: "${ganadora.carta}" de ${ganadora.nombre}`);

// 4. Limpieza.
for (const j of jugadores) j.ws.send(JSON.stringify({ t: "abandonar" }));
await new Promise((r) => setTimeout(r, 800));
const fantasma = await api(`/api/salas/${codigo}/join`, jugadores[0], { nombre: "F" });
if (fantasma.error !== "Sala no encontrada") throw new Error(`sala no borrada: ${JSON.stringify(fantasma)}`);
console.log("sala borrada ✔");

const errores = jugadores.flatMap((j) => j.errores);
if (errores.length) throw new Error(`errores: ${errores.join(" | ")}`);
console.log("SMOKE AUTH OK");
process.exit(0);
