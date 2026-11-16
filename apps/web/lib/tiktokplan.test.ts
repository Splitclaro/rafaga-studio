import { test } from "node:test";
import assert from "node:assert/strict";
import { planSchedule, templateCopy, parseCopy, composeCaption, copyPrompt, withHash, SUGGESTED_PROFILES, type PlanAccount } from "./tiktokplan.ts";

const NOW = new Date("2026-11-16T10:00:00Z");
const acc = (id: string, p: PlanAccount["profile"] = {}): PlanAccount => ({ id, name: id, profile: { tz: "UTC", slots: ["12:00", "18:00", "21:00"], daily_cap: 2, ...p } });
const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${i}` }));

test("reparte los vídeos entre cuentas y ninguno va a dos cuentas", () => {
  const r = planSchedule(ids(6), [acc("a"), acc("b")], { now: NOW });
  assert.equal(r.placed.length, 6); assert.deepEqual(r.unplaced, []);
  assert.equal(new Set(r.placed.map((p) => p.item)).size, 6);
  assert.equal(r.placed.filter((p) => p.account === "a").length, 3);
});
test("respeta el tope diario, no programa en el pasado y deja margen mínimo", () => {
  const r = planSchedule(ids(5), [acc("a")], { now: NOW, jitterMin: 0 });
  const byDay: Record<string, number> = {}; for (const p of r.placed) byDay[p.localDay] = (byDay[p.localDay] ?? 0) + 1;
  assert.ok(Object.values(byDay).every((n) => n <= 2), JSON.stringify(byDay));
  assert.ok(r.placed.every((p) => Date.parse(p.at) >= NOW.getTime() + 10 * 60000));
  assert.equal(r.placed[0].at, "2026-11-16T12:00:00.000Z");
});
test("es determinista con la misma semilla y distinto con otra (variación de horas)", () => {
  const a = planSchedule(ids(4), [acc("a")], { now: NOW, seed: 5 }), b = planSchedule(ids(4), [acc("a")], { now: NOW, seed: 5 }), c = planSchedule(ids(4), [acc("a")], { now: NOW, seed: 6 });
  assert.deepEqual(a, b); assert.notDeepEqual(a.placed.map((p) => p.at), c.placed.map((p) => p.at));
  for (const p of a.placed) { const m = new Date(p.at).getUTCMinutes(); assert.ok(m <= 12 || m >= 48, `variación fuera de ±12 min: ${p.at}`); }
});
test("las cuentas en pausa no reciben nada y se informa; lo que no cabe en el horizonte se devuelve", () => {
  const r = planSchedule(ids(4), [acc("a", { paused: true }), acc("b")], { now: NOW });
  assert.deepEqual(r.skipped, [{ account: "a", reason: "paused" }]); assert.ok(r.placed.every((p) => p.account === "b")); assert.equal(r.placed.length, 4);
  const s = planSchedule(ids(10), [acc("a", { daily_cap: 1, slots: ["12:00"] })], { now: NOW, horizonDays: 3 });
  assert.equal(s.placed.length, 3); assert.equal(s.unplaced.length, 7);
});
test("tiene en cuenta lo ya programado y la zona horaria (Madrid en invierno = UTC+1)", () => {
  const r = planSchedule(ids(2), [{ id: "a", name: "a", profile: { tz: "Europe/Madrid", slots: ["13:00"], daily_cap: 1 }, already: ["2026-11-16T12:00:00.000Z"] }], { now: NOW, jitterMin: 0 });
  assert.equal(r.placed[0].localDay, "2026-11-17"); assert.equal(r.placed[0].at, "2026-11-17T12:00:00.000Z");
});
test("una cuenta fijada que no existe deja el vídeo sin colocar (no se desvía a otra)", () => {
  const r = planSchedule([{ id: "x", account: "zzz" }, { id: "y" }], [acc("a")], { now: NOW });
  assert.deepEqual(r.unplaced, ["x"]); assert.equal(r.placed.length, 1);
});
test("texto de plantilla: título + artista + hashtags de identidad, sin pasar de 2200 y sin duplicados", () => {
  const c = templateCopy({ title: "Contando días", artist: "Crítika", genre: "Rap" }, { ...SUGGESTED_PROFILES["Te Lo Dedico"], hashtag_count: 6 });
  assert.match(c.description, /^Contando días - Crítika ⭐/); assert.equal(c.hashtags.length, 6); assert.ok(c.hashtags.includes("#paradedicar")); assert.equal(c.source, "plantilla");
  assert.equal(new Set(c.hashtags).size, c.hashtags.length);
  const big = composeCaption("x".repeat(2150), withHash(Array.from({ length: 30 }, (_, i) => `tag${i}`))); assert.ok(big.length <= 2200);
});
test("respuesta de la IA: se valida, se mezcla con los hashtags fijos y lo roto vuelve a la plantilla", () => {
  const songs = [{ title: "A", artist: "X" }, { title: "B" }], p = { hashtags: ["puntodeperreo"], hashtag_count: 4 };
  const out = parseCopy('```json\n{"items":[{"i":0,"text":"Pon esto en repeat 🔥","hashtags":["reggaeton","#perreo","musica"]}]}\n```', songs, p);
  assert.equal(out[0].source, "ia"); assert.match(out[0].description, /^Pon esto en repeat 🔥 #puntodeperreo #reggaeton/); assert.equal(out[0].hashtags.length, 4);
  assert.equal(out[1].source, "plantilla"); assert.match(out[1].description, /^B/);
  assert.equal(parseCopy("no es json", songs, p).every((c) => c.source === "plantilla"), true);
  assert.match(copyPrompt(songs, p, "Punto de Perreo").user, /#puntodeperreo/);
});
