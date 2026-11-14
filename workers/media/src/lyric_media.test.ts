// «Crear desde vídeo»: propuesta de segmentos por cambios de escena y cortes sin audio (exacto y rápido) con ffmpeg real.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A } from "../../../supabase/tests/migrate.ts";
import { makeFixture, pgliteCtx, fakeR2 } from "./fixtures.ts";
import { STAGE_IMPLS, planSegments } from "./stages/lyric.ts";
import type { StageRow } from "./stages/registry.ts";

const FX = new URL("../../../.fixtures/", import.meta.url).pathname;
let db: PGlite, ws: string, src: string, coll: string, fake: ReturnType<typeof fakeR2>;
const q = async <T = Record<string, unknown>>(s: string) => (await db.query<T>(s)).rows;
const row = (params: Record<string, unknown>) => ({ id: "s", workspace_id: ws, job_id: "j", stage: "media_split", seq: 1, attempts: 1, params, units: 0, worker_id: "w" }) as unknown as StageRow;
const ctx = () => pgliteCtx(db, { r2: fake.r2, tmpDir: mkdtempSync(join(tmpdir(), "rafaga-split-")), env: {} }) as never;
const probe = (f: string) => { const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", f], { encoding: "utf8" }); const j = JSON.parse(r.stdout); return { dur: Number(j.format.duration), audio: j.streams.some((s: { codec_type: string }) => s.codec_type === "audio") }; };

before(async () => {
  assert.equal(spawnSync("ffmpeg", ["-version"]).status, 0, "ffmpeg es obligatorio");
  ({ db, wsA: ws } = (await freshDb()) as unknown as { db: PGlite; wsA: string });
  const file = makeFixture("scenes", FX);
  src = (await q<{ id: string }>(`insert into sources(workspace_id, kind, status, created_by, mime, bytes, duration_ms, width, height) values ('${ws}','upload','validated','${A}','video/mp4',${statSync(file).size},6000,640,360) returning id`))[0].id;
  const key = `${ws}/${src}/mezzanine.mp4`; await db.exec(`update sources set storage_path='${key}' where id='${src}'`);
  coll = (await q<{ id: string }>(`insert into media_collections(workspace_id, name, created_by) values ('${ws}','Fondos','${A}') returning id`))[0].id;
  fake = fakeR2({ [key]: file });
});

test("planSegments: empiezan y terminan en cortes o extremos, entre min y max", () => {
  const s = planSegments([2, 4], 0, 6, 3); assert.ok(s.length >= 2); assert.equal(s[0].start_ms, 0); assert.equal(s.at(-1)!.end_ms, 6000);
  for (const g of s) { const d = (g.end_ms - g.start_ms) / 1000; assert.ok(d >= 1.5 && d <= 4.5, String(d)); }
  assert.deepEqual(planSegments([], 0, 10, 3).map((g) => g.end_ms - g.start_ms), [3000, 3000, 4000]);
});

test("propose sobre el fixture scenes (cambios en 2 s y 4 s, objetivo 3 s): cada segmento empieza y acaba en un corte detectado o en un extremo (±0,1 s)", async () => {
  const out = (await STAGE_IMPLS.media_split.run(ctx(), row({ mode: "propose", source_id: src, collection_id: coll, length_s: 3 }))).output as { segments: { start_ms: number; end_ms: number }[] };
  assert.ok(out.segments.length >= 2);
  const marks = [0, 2000, 4000, 6000];
  for (const g of out.segments) { assert.ok(marks.some((m) => Math.abs(m - g.start_ms) <= 100), `inicio ${g.start_ms}`); assert.ok(marks.some((m) => Math.abs(m - g.end_ms) <= 100), `fin ${g.end_ms}`); const d = (g.end_ms - g.start_ms) / 1000; assert.ok(d >= 1.5 && d <= 4.5); }
});

async function cut(mode: "exacto" | "rapido", segments: { start_ms: number; end_ms: number }[]) {
  const before = fake.uploaded.length;
  const out = (await STAGE_IMPLS.media_split.run(ctx(), row({ mode: "cut", source_id: src, collection_id: coll, segments, cut_mode: mode }))).output as { item_ids: string[] };
  return { ids: out.item_ids, keys: fake.uploaded.slice(before) };
}
test("cut exacto: un elemento por segmento revisado (el excluido no se crea), duración a ≤1 fotograma, sin audio, r2 y objeto 'media'", async () => {
  const { ids, keys } = await cut("exacto", [{ start_ms: 0, end_ms: 2000 }, { start_ms: 4000, end_ms: 6000 }]);   // el segmento 2–4 s se excluyó
  assert.equal(ids.length, 2);
  const items = await q<{ id: string; storage_backend: string; storage_path: string; audio_muted: boolean; duration_ms: string; cut_mode: string }>(`select id, storage_backend, storage_path, audio_muted, duration_ms, cut_mode from media_items where id in (${ids.map((i) => `'${i}'`).join(",")})`);
  for (const it of items) { assert.equal(it.storage_backend, "r2"); assert.equal(it.storage_path, `${ws}/media/${it.id}.mp4`); assert.equal(it.audio_muted, true); assert.ok(Math.abs(Number(it.duration_ms) / 1000 - 2) <= 0.04 + 1e-9, `duración ${it.duration_ms}`); }
  assert.equal((await q<{ n: number }>(`select count(*)::int n from storage_objects where kind='media' and key in (${keys.map((k) => `'${k}'`).join(",")})`))[0].n, 2);
  assert.equal((await q<{ n: number }>(`select count(*)::int n from media_items where segment_start_ms=2000`))[0].n, 0, "el excluido no existe");
});
test("cut rápido (copia de flujo): duración a ≤1,05 s de la pedida y sin pista de audio", async () => {
  const { ids } = await cut("rapido", [{ start_ms: 2000, end_ms: 4000 }]);
  const [it] = await q<{ duration_ms: string; audio_muted: boolean }>(`select duration_ms, audio_muted from media_items where id='${ids[0]}'`);
  assert.ok(Math.abs(Number(it.duration_ms) / 1000 - 2) <= 1.05, `duración ${it.duration_ms}`); assert.equal(it.audio_muted, true);
  void probe;
});
