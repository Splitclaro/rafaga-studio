// Estilos v2: límite de 20 en la base de datos, tamaño máximo antes de llamar, capas del preset y A/B.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { DEFAULT_CAPTION, surpriseCaption, validateCaptionStyle } from "@rafaga/composition";
import { freshDb, A } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor } from "../../../supabase/tests/fake-supabase.ts";
import { rpc } from "./api.ts";
import { saveStyle, deleteStyle, listStylesV2, applyPreset, styleLayers, abState, toggleAB, currentStyle, type RpcFn } from "./styles.ts";

let db: PGlite, ws: string, calls = 0;
const run: RpcFn = async (fn, args) => { calls++; const r = await rpc(tokenFor(A), fn, args, fakeSupabaseFetch(db)); return { data: r.data, error: r.error ? { message: r.error.message, code: r.error.code } : null }; };
before(async () => { ({ db, wsA: ws } = (await freshDb()) as unknown as { db: PGlite; wsA: string }); });

test("20 estilos v2 se guardan, el 21.º se rechaza con style_limit y se conservan los 20; borrar uno permite guardar otro", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 20; i++) { const r = await saveStyle(run, ws, null, `Estilo ${i}`, surpriseCaption(i), "frase_palabra_activa"); assert.ok(r.ok, JSON.stringify(r)); if (r.ok) ids.push(r.id); }
  const over = await saveStyle(run, ws, null, "Uno de más", surpriseCaption(99), "texto_estatico");
  assert.equal(over.ok, false); assert.equal(!over.ok && over.error, "style_limit");
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from text_styles where style->>'rafagaStyle'='2'")).rows[0].n, 20);
  assert.ok(await deleteStyle(run, ids[0]));
  assert.ok((await saveStyle(run, ws, null, "Nuevo", surpriseCaption(100), "texto_estatico")).ok);
  const rows = (await db.query<{ id: string; name: string; style: unknown }>("select id, name, style from text_styles")).rows;
  const list = listStylesV2(rows); assert.equal(list.length, 20); assert.ok(list.every((s) => s.style.rafagaStyle === 2));
});

test("un estilo de más de 4000 bytes se rechaza con style_too_large antes de llamar a la base de datos", async () => {
  const before = calls;
  const r = await saveStyle(run, ws, null, "Enorme", { ...DEFAULT_CAPTION, extra: "x".repeat(4100) }, "frase_palabra_activa");
  assert.equal(r.ok, false); assert.equal(!r.ok && r.error, "style_too_large"); assert.equal(calls, before, "no hubo llamada");
});

test("applyPreset cambia solo la animación: la capa de fuente y la de posición quedan idénticas", () => {
  const s = validateCaptionStyle({ ...DEFAULT_CAPTION, font: "Oswald", weight: 400, case: "upper", size: "L", sizeFine: 1.2, position: { x: 0.5, y: 0.3 } });
  for (const id of ["frase_palabra_activa", "palabra_a_palabra", "escritura_progresiva", "texto_estatico", "entrada_deslizada"] as const) {
    const t = applyPreset(s, id), a = styleLayers(s), b = styleLayers(t);
    assert.deepEqual(b.font, a.font); assert.deepEqual(b.layout, a.layout);
    assert.equal(t.color, s.color); assert.deepEqual(validateCaptionStyle(t), t);
  }
  assert.equal(applyPreset(s, "escritura_progresiva").entrance, "typewriter"); assert.equal(applyPreset(s, "texto_estatico").entrance, "none");
});

test("toggleAB cambia solo el estilo: mismo instante, misma letra y mismo fondo", () => {
  const a = surpriseCaption(1), b = surpriseCaption(2), s0 = abState(a, b, 12.5, "hola mundo", "#112233"), s1 = toggleAB(s0), s2 = toggleAB(s1);
  assert.deepEqual(currentStyle(s0), a); assert.deepEqual(currentStyle(s1), b); assert.deepEqual(currentStyle(s2), a);
  for (const s of [s1, s2]) { assert.equal(s.t, 12.5); assert.equal(s.lyrics, "hola mundo"); assert.equal(s.background, "#112233"); }
});
