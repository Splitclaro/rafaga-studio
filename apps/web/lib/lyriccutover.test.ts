import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOKS } from "@rafaga/lyrics";
import { validateCaptionStyle } from "@rafaga/composition";
import { classicPresets, libraryVideos, songBadge, offerToV2 } from "./lyriccutover.ts";

test("classicPresets: tres presets con estilo v2 válido (caja lower, color del look, peso 400 o 700) y ajustes de fondo derivados; LOOKS de v1 no cambia", () => {
  const before = JSON.stringify(LOOKS), ps = classicPresets();
  assert.deepEqual(ps.map((p) => p.id), ["archivo", "diario", "panoramico"]);
  for (const p of ps) { assert.deepEqual(validateCaptionStyle(p.style), p.style); assert.equal(p.style.case, "lower"); assert.ok([400, 700].includes(p.style.weight)); assert.equal(p.style.color, LOOKS[p.id].text.color); assert.ok(["fill", "band", "preserve"].includes(p.settings.fit)); assert.ok(p.settings.dim >= 0 && p.settings.dim <= 0.8); assert.equal(p.settings.interval, Math.min(15, Math.max(2, LOOKS[p.id].montage.interval))); }
  assert.equal(JSON.stringify(LOOKS), before);
});
test("libraryVideos incluye vídeos anteriores y exportaciones v2 con estado y origen; los anteriores listos conservan su ruta de Storage", () => {
  const v = libraryVideos([{ id: "a", variant: 2, status: "ready", storage_path: "ws/lyrics/a.mp4", song_title: "Tema" }, { id: "b", variant: 1, status: "rendering", storage_path: null }], [{ id: "c", status: "ready", title: "Nueva" }]);
  assert.deepEqual(v.map((x) => [x.id, x.origin, x.status]), [["c", "v2", "ready"], ["a", "anterior", "ready"], ["b", "anterior", "rendering"]]);
  assert.equal(v[1].download, "storage"); assert.equal(v[1].path, "ws/lyrics/a.mp4"); assert.equal(v[2].download, null); assert.equal(v[0].download, "export");
});
test("una canción sin source_id es «Clásica» y no se ofrece al flujo v2", () => {
  assert.equal(songBadge({ source_id: null }), "Clásica"); assert.equal(songBadge({ source_id: "x" }), null); assert.equal(offerToV2({ source_id: null }), false); assert.equal(offerToV2({ source_id: "x" }), true);
});
