// 3 bots que se unen a una sala y juegan solos: para llenar sillas en un
// playtest (mínimo 4 jugadores) o probar el tablero sin más gente.
// Requiere Bun (usa su extensión de headers en el WebSocket del cliente).
// Uso: bun scripts/bots.mjs <CODIGO> [base]
//   base por defecto: http://localhost:8787 (wrangler dev)
//   contra staging/prod: bun scripts/bots.mjs ABC123 https://…workers.dev
const CODIGO = process.argv[2];
const BASE = process.argv[3] ?? "http://localhost:8787";
if (!CODIGO) throw new Error("falta el código de sala");
const WS_BASE = BASE.replace(/^http/, "ws");

async function bot(nombre) {
  const res = await fetch(`${BASE}/api/auth/sign-in/anonymous`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const { user } = await res.json();
  const uid = user.id;

  const join = await fetch(`${BASE}/api/salas/${CODIGO}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ nombre }),
  });
  if (!join.ok) throw new Error(`${nombre}: join falló ${join.status}`);

  const ws = new WebSocket(`${WS_BASE}/salas/${CODIGO}/ws`, { headers: { cookie } });
  let ocupado = false;

  ws.addEventListener("message", async (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "error") return console.log(`${nombre} error: ${m.mensaje}`);
    if (m.t !== "snapshot" || ocupado) return;
    const { sala, mano, jugaron, jugadores, mesa } = m;
    const yo = jugadores.find((j) => j.uid === uid);
    const soyJuez = sala.juezUid === uid;
    const misJugadas = jugaron.filter((u) => u === uid).length;

    if (sala.fase === "jugando" && !soyJuez && misJugadas < (yo?.cartasAJugar ?? 1) && mano.length) {
      ocupado = true;
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 1500));
      ws.send(JSON.stringify({ t: "jugar_carta", carta: mano[0] }));
      console.log(`${nombre} jugó una carta (ronda ${sala.ronda})`);
      ocupado = false;
    } else if (sala.fase === "juzgando" && soyJuez && mesa.length) {
      ocupado = true;
      await new Promise((r) => setTimeout(r, 1500));
      const pick = mesa[Math.floor(Math.random() * mesa.length)];
      ws.send(JSON.stringify({ t: sala.mejorMesaId ? "elegir_peor" : "elegir_ganadora", mesaId: pick.id }));
      console.log(`${nombre} (juez) eligió`);
      ocupado = false;
    } else if (sala.fase === "resultado" && soyJuez && sala.ruletaEfecto !== 5) {
      ocupado = true;
      await new Promise((r) => setTimeout(r, 4000));
      ws.send(JSON.stringify({ t: "siguiente_ronda" }));
      ocupado = false;
    } else if (sala.fase === "resultado" && sala.ruletaEfecto === 5 && sala.peorUid === uid) {
      ocupado = true;
      await new Promise((r) => setTimeout(r, 2000));
      const otro = jugadores.find((j) => j.uid !== uid);
      ws.send(JSON.stringify({ t: "pasar_mamon", targetUid: otro.uid }));
      console.log(`${nombre} pasó el mamón a ${otro.nombre}`);
      ocupado = false;
    }
  });
  ws.addEventListener("open", () => console.log(`${nombre} conectado`));
  ws.addEventListener("close", () => console.log(`${nombre} desconectado`));
}

await bot("Bot Maiquetía");
await bot("Bot Petare");
await bot("Bot Catia");
console.log("bots listos — juega desde el navegador");
