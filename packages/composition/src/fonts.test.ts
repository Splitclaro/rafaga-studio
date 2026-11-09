import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { sniffFont, fontFamily, renderFamily } from "./fonts.ts";
const local = new URL("../../../.spike/fonts/BootzyTM.ttf", import.meta.url).pathname; // fuera del repo público
test("rechaza archivos que no son TTF/OTF", () => {
  assert.equal(sniffFont(new TextEncoder().encode("<html>no soy fuente")), null);
  assert.equal(sniffFont(new Uint8Array([0x77, 0x4f, 0x46, 0x46])), null); // woff no admitido
});
test("Arial se renderiza con Liberation Sans", () => assert.equal(renderFamily("Arial"), "Liberation Sans"));
test("lee la familia de una fuente real (si está disponible localmente)", { skip: !existsSync(local) }, () => {
  const b = new Uint8Array(readFileSync(local));
  assert.equal(sniffFont(b), "ttf");
  assert.equal(fontFamily(b), "Bootzy TM");
});
