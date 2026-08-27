import { describe, expect, it } from "vitest";
import { MANO_SIZE, jugarCarta } from "./index.js";
import { jugadasDe, jugarTodos, noJueces, partidaIniciada } from "./test-utils.js";

describe("Piensa Rápido", () => {
  it("el último en jugar recupera su carta y no compite", () => {
    const { estado, ctx } = partidaIniciada(6, { config: { piensaRapido: true } });
    const jugadores = noJueces(estado); // 5
    jugarTodos(estado, ctx, 2_000); // 2s entre jugadas → la ronda dura 10s
    expect(estado.fase).toBe("juzgando");
    const ultimo = jugadores.at(-1);
    expect(jugadasDe(estado, ultimo.uid)).toHaveLength(0);
    expect(estado.manos[ultimo.uid]).toHaveLength(MANO_SIZE); // recuperó la carta
    expect(estado.mesa).toHaveLength(4);
  });

  it("si todos juegan en menos de 5s, nadie pierde", () => {
    const { estado, ctx } = partidaIniciada(6, { config: { piensaRapido: true } });
    jugarTodos(estado, ctx, 500); // todo en 2.5s
    expect(estado.fase).toBe("juzgando");
    expect(estado.mesa).toHaveLength(5);
  });

  it("sin Piensa Rápido nadie pierde aunque tarde", () => {
    const { estado, ctx } = partidaIniciada(6);
    jugarTodos(estado, ctx, 3_000);
    expect(estado.mesa).toHaveLength(5);
  });

  it("con una sola jugada en mesa no hay penalización", () => {
    // El único que jugó no puede "perder" (no habría nada que juzgar).
    const { estado, ctx } = partidaIniciada(6, { config: { piensaRapido: true } });
    // Desconectar a todos los no-Juez menos uno para que su jugada cierre.
    const [unico, ...resto] = noJueces(estado);
    for (const j of resto) j.conectado = false;
    ctx.avanzar(10_000);
    jugarCarta(estado, unico.uid, estado.manos[unico.uid][0], ctx);
    expect(estado.fase).toBe("juzgando");
    expect(estado.mesa).toHaveLength(1);
  });
});
