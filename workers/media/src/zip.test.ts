import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipBuilder, zipName } from "./zip.ts";

test("zipName neutraliza rutas peligrosas", () => {
  assert.equal(zipName("../../etc/passwd"), "etc/passwd"); assert.equal(zipName("/abs/x.mp4"), "abs/x.mp4"); assert.equal(zipName("a\\b:c.txt"), "a/b_c.txt");
  assert.throws(() => zipName("../.."));
});
const has = spawnSync("unzip", ["-v"]).status === 0;
test("ZIP válido: lo abre unzip -t, con nombres UTF-8 y contenido íntegro", { skip: !has }, () => {
  const d = mkdtempSync(join(tmpdir(), "zip-"));
  try {
    const z = new ZipBuilder(); const big = Buffer.alloc(300_000, 7);
    z.add("video/marca_Entrega_01-Cómo_hablar_9x16_v1.mp4", big); z.add("manifiesto.json", Buffer.from('{"ok":true,"ñ":"é"}')); z.add("vacío.txt", Buffer.alloc(0));
    writeFileSync(join(d, "p.zip"), z.build());
    const t = spawnSync("unzip", ["-t", join(d, "p.zip")], { encoding: "utf8" }); assert.equal(t.status, 0, t.stdout + t.stderr); assert.match(t.stdout, /No errors detected/);
    const l = spawnSync("unzip", ["-Z1", join(d, "p.zip")], { encoding: "utf8" }).stdout; assert.match(l, /mo_hablar/); assert.match(l, /vac.{1,3}o\.txt/);   // unzip imprime los UTF-8 según el locale; el contenido es válido
    spawnSync("unzip", ["-o", "-q", join(d, "p.zip"), "manifiesto.json", "-d", d]); assert.equal(readFileSync(join(d, "manifiesto.json"), "utf8"), '{"ok":true,"ñ":"é"}');
    assert.equal(z.count, 3);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
