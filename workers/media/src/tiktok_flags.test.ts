import { test } from "node:test";
import assert from "node:assert/strict";
import { tikTokFlags } from "./stages/integrations.ts";

test("tikTokFlags: sin opciones todo queda desactivado (valor por defecto exigido por TikTok)", () => {
  assert.deepEqual(tikTokFlags(undefined), { disable_comment: true, disable_duet: true, disable_stitch: true });
});
test("tikTokFlags: respeta lo activado y lo que la cuenta tiene desactivado en TikTok", () => {
  const f = tikTokFlags({ comment: true, duet: true, stitch: true }, { duet_disabled: true });
  assert.equal(f.disable_comment, false); assert.equal(f.disable_duet, true); assert.equal(f.disable_stitch, false);
});
test("tikTokFlags: contenido comercial", () => {
  const f = tikTokFlags({ commercial: true, own_brand: true }) as Record<string, unknown>;
  assert.equal(f.brand_organic_toggle, true); assert.equal(f.brand_content_toggle, false);
});
