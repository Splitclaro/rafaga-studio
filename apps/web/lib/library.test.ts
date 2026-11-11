import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicates, findExisting, normalizeName, filterAssets, countByKind, type Asset } from "./library.ts";

let n = 0;
const A = (o: Partial<Asset>): Asset => ({ asset_key: `k${++n}`, kind: "video", name: "clip.mp4", bucket: "originals", storage_path: `ws/media/${n}.mp4`, bytes: 1000, fingerprint: null, fingerprint_kind: null, container: "Pack", ref_table: "media_items", ref_id: `id${n}`, created_at: `2026-11-0${(n % 9) + 1}T00:00:00Z`, ...o });

test("normalizeName ignora extensión, copias y signos", () => {
  assert.equal(normalizeName("Mi_Vídeo (1).MP4"), "mi vídeo");
  assert.equal(normalizeName("playa-copia.mp4"), "playa");
  assert.equal(normalizeName("Playa.mp4"), "playa");
});
test("exactos: misma huella y tamaño; conserva el más antiguo y solo ofrece quitar copias de packs", () => {
  const a = A({ fingerprint: "abc", fingerprint_kind: "etag", created_at: "2026-01-01T00:00:00Z", name: "a.mp4" });
  const b = A({ fingerprint: "abc", fingerprint_kind: "etag", created_at: "2026-02-01T00:00:00Z", name: "b.mp4" });
  const c = A({ fingerprint: "abc", fingerprint_kind: "etag", created_at: "2026-03-01T00:00:00Z", kind: "audio", ref_table: "songs", name: "c" });
  const g = findDuplicates([c, b, a]);
  assert.equal(g.length, 1); assert.equal(g[0].confidence, "exact");
  assert.equal(g[0].keep, a); assert.deepEqual(g[0].removable, [b]);
  assert.match(g[0].note, /no se pueden quitar/);
});
test("misma huella con tamaño distinto no es duplicado", () => {
  const g = findDuplicates([A({ fingerprint: "x", fingerprint_kind: "etag", bytes: 1 }), A({ fingerprint: "x", fingerprint_kind: "etag", bytes: 2 })]);
  assert.equal(g.length, 0);
});
test("sha256 y etag no se mezclan", () => {
  assert.equal(findDuplicates([A({ name: "u.mp4", fingerprint: "x", fingerprint_kind: "etag" }), A({ name: "v.mp4", fingerprint: "x", fingerprint_kind: "sha256" })]).length, 0);
});
test("la misma ruta de storage referida dos veces no es copia", () => {
  const p = "ws/brand/logo.png";
  assert.equal(findDuplicates([A({ fingerprint: "q", fingerprint_kind: "etag", storage_path: p, kind: "logo", ref_table: "brand_kits" }), A({ fingerprint: "q", fingerprint_kind: "etag", storage_path: p, kind: "image" })]).length, 0);
});
test("exportaciones no cuentan como duplicado", () => {
  assert.equal(findDuplicates([A({ kind: "export", fingerprint: "e", fingerprint_kind: "etag" }), A({ kind: "export", fingerprint: "e", fingerprint_kind: "etag" })]).length, 0);
});
test("posibles: mismo nombre y tamaño sin huella; nunca se ofrece borrar", () => {
  const g = findDuplicates([A({ name: "Playa.mp4", bytes: 500 }), A({ name: "playa (1).mp4", bytes: 500 })]);
  assert.equal(g.length, 1); assert.equal(g[0].confidence, "possible"); assert.deepEqual(g[0].removable, []);
});
test("mismo nombre y tamaño pero huellas distintas = archivos distintos", () => {
  assert.equal(findDuplicates([A({ name: "p.mp4", bytes: 5, fingerprint: "1", fingerprint_kind: "etag" }), A({ name: "p.mp4", bytes: 5, fingerprint: "2", fingerprint_kind: "etag" })]).length, 0);
});
test("un asset en grupo exacto no vuelve a salir como posible", () => {
  const g = findDuplicates([A({ name: "p.mp4", bytes: 5, fingerprint: "1", fingerprint_kind: "etag" }), A({ name: "p.mp4", bytes: 5, fingerprint: "1", fingerprint_kind: "etag" }), A({ name: "p.mp4", bytes: 5 })]);
  assert.equal(g.length, 1); assert.equal(g[0].assets.length, 2);
});
test("findExisting avisa por nombre y tamaño", () => {
  const all = [A({ name: "Playa.mp4", bytes: 77 })];
  assert.equal(findExisting({ name: "playa (2).mp4", size: 77 }, all).length, 1);
  assert.equal(findExisting({ name: "playa.mp4", size: 78 }, all).length, 0);
});
test("filtros y conteos", () => {
  const all = [A({ kind: "video", name: "Sol" }), A({ kind: "audio", name: "Canción" }), A({ kind: "font", name: "Sol Sans" })];
  assert.equal(filterAssets(all, { kind: "all", q: "sol" }).length, 2);
  assert.equal(filterAssets(all, { kind: "font", q: "" }).length, 1);
  assert.deepEqual(filterAssets(all, { kind: "all", q: "", dupKeys: new Set([all[1].asset_key]) }), [all[1]]);
  assert.equal(countByKind(all).all, 3);
});
import { assetHref, fmtBytes } from "./library.ts";
test("enlaces por tipo y tamaños legibles", () => {
  assert.equal(assetHref({ ref_table: "songs", ref_id: "s1", kind: "audio" }), "/app/lyric-studio?song=s1");
  assert.equal(assetHref({ ref_table: "brand_kits", ref_id: "k", kind: "logo" }), "/app/brand-kits");
  assert.equal(assetHref({ ref_table: "renders", ref_id: "r", kind: "export" }), "/app/brand-kits?tab=videos");
  assert.equal(fmtBytes(null), "—"); assert.equal(fmtBytes(2097152), "2.0 MB"); assert.equal(fmtBytes(100), "1 KB");
});
